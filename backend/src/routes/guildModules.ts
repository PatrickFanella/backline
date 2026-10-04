import { PermissionFlagsBits } from 'discord.js';
import { Router } from 'express';
import { z } from 'zod';

import { onboardingConfig, selfRolesConfig } from '../community/config';
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
            (req.params.moduleId === 'onboarding' &&
                onboardingConfig.parse(body.data.config).joinRoles.length) ||
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
