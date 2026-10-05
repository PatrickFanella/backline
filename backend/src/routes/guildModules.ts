import { PermissionFlagsBits } from 'discord.js';
import { Router } from 'express';
import { z } from 'zod';

import {
    onboardingConfig,
    selfRolesConfig,
    antiSpamConfig,
    levelingConfig,
    communityReportsConfig,
} from '../community/config';
import { db } from '../db';
import { listManagedGuilds } from '../guilds/authorization';
import { requireAuthOrApiKey, requireGuildAccess } from '../middleware';
import { moduleOperatorReady, moduleRegistry } from '../modules/registry';

const router = Router();
router.get('/guilds', requireAuthOrApiKey, async (req, res) => {
    try {
        res.json(await listManagedGuilds(req.user!.userId));
    } catch {
        res.status(503).json({
            error: 'Current Discord server authorization unavailable. Sign in again or retry.',
        });
    }
});
const updateSchema = z.object({
    enabled: z.boolean(),
    config: z.unknown().default({}),
});
router.use('/guilds/:guildId/modules', requireAuthOrApiKey, requireGuildAccess);
router.get('/guilds/:guildId/modules/anti-spam/history', async (req, res) => {
    try {
        const decisions = await db.spamDecision.findMany({
            where: { guildId: req.params.guildId },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
        const jobs = await db.durableJob.findMany({
            where: {
                guildId: req.params.guildId,
                id: {
                    in: decisions.flatMap((decision) =>
                        decision.jobId ? [decision.jobId] : []
                    ),
                },
            },
            select: { id: true, state: true, lastError: true },
        });
        res.json({
            decisions: decisions.map((decision) => ({
                ...decision,
                delivery: jobs.find((job) => job.id === decision.jobId) ?? null,
            })),
            raid: await db.raidState.findUnique({
                where: { guildId: req.params.guildId },
            }),
        });
    } catch {
        res.status(503).json({ error: 'Anti-spam history unavailable' });
    }
});
router.delete('/guilds/:guildId/modules/anti-spam/raid', async (req, res) => {
    try {
        await db.raidState.deleteMany({
            where: { guildId: req.params.guildId },
        });
        res.json({ success: true });
    } catch {
        res.status(503).json({ error: 'Raid controls unavailable' });
    }
});
router.get('/guilds/:guildId/modules/self-roles/history', async (req, res) => {
    try {
        res.json(
            await db.roleChoice.findMany({
                where: {
                    guildId: req.params.guildId,
                    createdAt: { gte: new Date(Date.now() - 90 * 86400000) },
                },
                orderBy: { createdAt: 'desc' },
                take: 100,
            })
        );
    } catch {
        res.status(503).json({ error: 'Role choice history unavailable' });
    }
});
router.get('/guilds/:guildId/modules/onboarding/history', async (req, res) => {
    try {
        res.json(
            await db.memberJourney.findMany({
                where: {
                    guildId: req.params.guildId,
                    expiresAt: { gt: new Date() },
                },
                orderBy: { createdAt: 'desc' },
                take: 100,
            })
        );
    } catch {
        res.status(503).json({ error: 'Onboarding history unavailable' });
    }
});
router.get('/guilds/:guildId/modules/audit-log/history', async (req, res) => {
    try {
        res.json(
            await db.serverAuditEvent.findMany({
                where: {
                    guildId: req.params.guildId,
                    expiresAt: { gt: new Date() },
                },
                orderBy: { createdAt: 'desc' },
                take: 100,
            })
        );
    } catch {
        res.status(503).json({ error: 'Audit history unavailable' });
    }
});
router.get('/guilds/:guildId/modules', async (req, res) => {
    try {
        const settings = await db.guildModuleConfig.findMany({
            where: { guildId: req.params.guildId },
        });
        res.json(
            moduleRegistry.list().map((module) => ({
                id: module.id,
                description: module.description,
                version: module.version,
                permissions: module.permissions.map(String),
                actionPermissions: Object.fromEntries(
                    Object.entries(module.actionPermissions ?? {}).map(
                        ([action, permissions]) => [
                            action,
                            permissions.map(String),
                        ]
                    )
                ),
                intents: module.intents,
                pendingJobPolicy: module.pendingJobPolicy,
                operatorReady: moduleOperatorReady(module),
                settings: settings.find(
                    (row) => row.moduleId === module.id
                ) ?? { enabled: false, config: {} },
            }))
        );
    } catch {
        res.status(503).json({ error: 'Module settings unavailable' });
    }
});
router.put('/guilds/:guildId/modules/:moduleId', async (req, res) => {
    const body = updateSchema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: 'Invalid module settings' });
        return;
    }
    try {
        if (
            req.params.moduleId === 'community-reports' &&
            communityReportsConfig.parse(body.data.config).counters.length
        ) {
            const membership = await db.guild.findUnique({
                where: {
                    userId_guildId: {
                        userId: req.user!.userId,
                        guildId: req.params.guildId,
                    },
                },
            });
            if (
                !membership ||
                (!membership.owner &&
                    !(
                        membership.permissions &
                        (PermissionFlagsBits.ManageChannels |
                            PermissionFlagsBits.Administrator)
                    ))
            ) {
                res.status(403).json({
                    error: 'Current Manage Channels permission is required to configure channel counters',
                });
                return;
            }
        }
        if (req.params.moduleId === 'tickets') {
            const member = await db.guild.findUnique({
                where: {
                    userId_guildId: {
                        userId: req.user!.userId,
                        guildId: req.params.guildId,
                    },
                },
            });
            const required =
                PermissionFlagsBits.ManageChannels |
                PermissionFlagsBits.ManageRoles;
            if (
                !member ||
                (!member.owner &&
                    !(member.permissions & PermissionFlagsBits.Administrator) &&
                    (member.permissions & required) !== required)
            ) {
                res.status(403).json({
                    error: 'Current Manage Channels and Manage Roles permissions are required for ticket configuration',
                });
                return;
            }
        }
        if (
            (req.params.moduleId === 'onboarding' &&
                onboardingConfig.parse(body.data.config).joinRoles.length) ||
            (req.params.moduleId === 'leveling' &&
                levelingConfig.parse(body.data.config).rewards.length) ||
            (req.params.moduleId === 'self-roles' &&
                selfRolesConfig.parse(body.data.config).roles.length)
        ) {
            const membership = await db.guild.findUnique({
                where: {
                    userId_guildId: {
                        userId: req.user!.userId,
                        guildId: req.params.guildId,
                    },
                },
            });
            if (
                !membership ||
                (!membership.owner &&
                    !(
                        membership.permissions &
                        (PermissionFlagsBits.ManageRoles |
                            PermissionFlagsBits.Administrator)
                    ))
            ) {
                res.status(403).json({
                    error: 'Current Manage Roles permission is required to configure role assignments',
                });
                return;
            }
        }
        if (
            req.params.moduleId === 'anti-spam' &&
            !antiSpamConfig.parse(body.data.config).observeOnly
        ) {
            const membership = await db.guild.findUnique({
                where: {
                    userId_guildId: {
                        userId: req.user!.userId,
                        guildId: req.params.guildId,
                    },
                },
            });
            if (
                !membership ||
                (!membership.owner &&
                    !(
                        membership.permissions &
                        (PermissionFlagsBits.ModerateMembers |
                            PermissionFlagsBits.Administrator)
                    ))
            ) {
                res.status(403).json({
                    error: 'Current Moderate Members permission is required to enable enforcement',
                });
                return;
            }
        }
        await moduleRegistry.configure(
            req.params.guildId,
            req.params.moduleId,
            body.data.enabled,
            body.data.config
        );
        res.json({ success: true });
    } catch {
        res.status(400).json({
            error: 'Unknown module, invalid configuration or unavailable installation',
        });
    }
});
export default router;
