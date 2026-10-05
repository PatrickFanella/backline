import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';
import {
    AttachmentBuilder,
    Client,
    Guild,
    Interaction,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';
import { z } from 'zod';

import { db } from '../db';
import { enqueueJob, JobHandler } from '../jobs/store';
import { moduleRegistry } from '../modules/registry';

import { recoveryConfig, structureSchema } from './config';

export async function recoveryGuild(
    client: Client,
    guildId: string,
    actorId?: string
) {
    if (!(await moduleRegistry.enabled(guildId, 'recovery')))
        throw new Error('Recovery disabled');
    const guild = await client.guilds.fetch({ guild: guildId, force: true });
    if (actorId) {
        const [member, account] = await Promise.all([
            guild.members.fetch({ user: actorId, force: true }),
            db.user.findUnique({
                where: { discordId: actorId },
                select: { role: true },
            }),
        ]);
        if (
            member.user.bot ||
            account?.role === 'BANNED' ||
            !member.permissions.has(PermissionFlagsBits.ManageGuild)
        )
            throw new Error('Current Manage Server permission required');
    }
    return guild;
}
export async function collectStructure(guild: Guild) {
    const [roles, channels] = await Promise.all([
        guild.roles.fetch(),
        guild.channels.fetch(),
    ]);
    if (roles.size > 500 || channels.size > 500)
        throw new Error('Server structure exceeds snapshot limit');
    const manifest = structureSchema.parse({
        version: 1,
        guildId: guild.id,
        name: guild.name,
        capturedAt: new Date().toISOString(),
        roles: [...roles.values()]
            .map((role) => ({
                id: role.id,
                name: role.name,
                color: role.color,
                permissions: role.permissions.bitfield.toString(),
                position: role.position,
                managed: role.managed,
                hoist: role.hoist,
                mentionable: role.mentionable,
            }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        channels: [...channels.values()]
            .flatMap((channel) => {
                if (!channel) return [];
                const value = channel as typeof channel & {
                    topic?: string | null;
                    nsfw?: boolean;
                    bitrate?: number;
                    userLimit?: number;
                    rateLimitPerUser?: number;
                };
                return [
                    {
                        id: channel.id,
                        name: channel.name,
                        type: channel.type,
                        parentId: channel.parentId,
                        position: channel.rawPosition,
                        topic: value.topic ?? null,
                        nsfw: value.nsfw ?? false,
                        bitrate: value.bitrate ?? null,
                        userLimit: value.userLimit ?? null,
                        rateLimitPerUser: value.rateLimitPerUser ?? 0,
                        overwrites: [
                            ...channel.permissionOverwrites.cache.values(),
                        ]
                            .map((overwrite) => ({
                                id: overwrite.id,
                                type: overwrite.type,
                                allow: overwrite.allow.bitfield.toString(),
                                deny: overwrite.deny.bitfield.toString(),
                            }))
                            .sort((a, b) => a.id.localeCompare(b.id)),
                    },
                ];
            })
            .sort((a, b) => a.id.localeCompare(b.id)),
    });
    const serialized = JSON.stringify(manifest);
    if (
        Buffer.byteLength(serialized) > 1000000 ||
        manifest.channels.reduce(
            (count, channel) => count + channel.overwrites.length,
            0
        ) > 5000
    )
        throw new Error('Snapshot exceeds storage limit');
    return {
        manifest,
        checksum: createHash('sha256').update(serialized).digest('hex'),
    };
}
export async function captureSnapshot(
    client: Client,
    guildId: string,
    actorId: string | null,
    requestId: string,
    kind: 'MANUAL' | 'SCHEDULED' | 'TEMPLATE' = 'MANUAL'
) {
    if (!requestId || requestId.length > 150)
        throw new Error('Invalid snapshot request');
    const guild = await recoveryGuild(client, guildId, actorId ?? undefined);
    const collected = await collectStructure(guild);
    return db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
        );
        const installation = await tx.guildInstallation.findUnique({
                where: { guildId },
            }),
            settings = await tx.guildModuleConfig.findUnique({
                where: { guildId_moduleId: { guildId, moduleId: 'recovery' } },
            });
        if (!installation?.active || !settings?.enabled)
            throw new Error('Recovery disabled');
        const config = recoveryConfig.parse(settings.config);
        if (kind === 'SCHEDULED' && !config.scheduled)
            throw new Error('Scheduled capture disabled');
        const previous = await tx.serverSnapshot.findUnique({
            where: { guildId_requestId: { guildId, requestId } },
        });
        if (previous) {
            if (previous.actorId !== actorId)
                throw new Error('Snapshot request belongs to another actor');
            return previous;
        }
        if (
            kind === 'TEMPLATE' &&
            (await tx.serverSnapshot.count({
                where: { guildId, kind: 'TEMPLATE' },
            })) >= 5
        )
            throw new Error('Template capacity reached');
        if ((await tx.serverSnapshot.count({ where: { guildId } })) >= 10) {
            const oldest = await tx.serverSnapshot.findFirst({
                where: { guildId, kind: { not: 'TEMPLATE' } },
                orderBy: { createdAt: 'asc' },
            });
            if (!oldest) throw new Error('Snapshot capacity reached');
            await tx.serverSnapshot.delete({ where: { id: oldest.id } });
        }
        return tx.serverSnapshot.create({
            data: {
                guildId,
                actorId,
                requestId,
                kind,
                manifest: collected.manifest,
                checksum: collected.checksum,
                expiresAt: new Date(Date.now() + config.retainDays * 86400000),
            },
        });
    });
}
export async function exportSnapshot(guildId: string, id: string) {
    const snapshot = await db.serverSnapshot.findFirstOrThrow({
        where: { id, guildId, expiresAt: { gt: new Date() } },
    });
    const manifest = structureSchema.parse(snapshot.manifest);
    if (
        createHash('sha256').update(JSON.stringify(manifest)).digest('hex') !==
        snapshot.checksum
    )
        throw new Error('Snapshot checksum mismatch');
    return {
        snapshotId: snapshot.id,
        checksum: snapshot.checksum,
        kind: snapshot.kind,
        manifest,
    };
}
export function snapshotCaptureHandler(client: Client): JobHandler {
    return {
        authorize: async (job) => {
            await recoveryGuild(client, job.guildId);
            const settings = await db.guildModuleConfig.findUniqueOrThrow({
                where: {
                    guildId_moduleId: {
                        guildId: job.guildId,
                        moduleId: 'recovery',
                    },
                },
            });
            return (
                recoveryConfig.parse(settings.config).scheduled &&
                job.actorId === 'system:recovery'
            );
        },
        execute: async (job) => {
            z.object({ scheduled: z.literal(true) })
                .strict()
                .parse(job.payload);
            const snapshot = await captureSnapshot(
                client,
                job.guildId,
                null,
                job.idempotencyKey,
                'SCHEDULED'
            );
            return {
                state: 'DELIVERED',
                result: {
                    snapshotId: snapshot.id,
                    checksum: snapshot.checksum,
                },
            };
        },
        reconcile: async (job) => {
            const snapshot = await db.serverSnapshot.findUnique({
                where: {
                    guildId_requestId: {
                        guildId: job.guildId,
                        requestId: job.idempotencyKey,
                    },
                },
            });
            return snapshot
                ? {
                      state: 'DELIVERED',
                      result: {
                          snapshotId: snapshot.id,
                          checksum: snapshot.checksum,
                      },
                  }
                : {
                      state: 'RETRY',
                      reason: 'Read-only capture can be repeated',
                  };
        },
    };
}
let snapshotCursor: string | undefined;
export async function maintainSnapshots(now = new Date()) {
    await db.serverSnapshot.deleteMany({ where: { expiresAt: { lte: now } } });
    const settings = await db.guildModuleConfig.findMany({
        where: {
            moduleId: 'recovery',
            enabled: true,
            ...(snapshotCursor ? { guildId: { gt: snapshotCursor } } : {}),
        },
        orderBy: { guildId: 'asc' },
        take: 100,
    });
    snapshotCursor = settings.length === 100 ? settings[99].guildId : undefined;
    for (const row of settings) {
        try {
            const config = recoveryConfig.parse(row.config);
            if (
                !config.scheduled ||
                !(await moduleRegistry.enabled(row.guildId, 'recovery'))
            )
                continue;
            const window = Math.floor(
                now.getTime() / (config.intervalHours * 3600000)
            );
            await enqueueJob({
                guildId: row.guildId,
                actorId: 'system:recovery',
                kind: 'snapshot-capture',
                moduleId: 'recovery',
                idempotencyKey:
                    'snapshot:' + config.intervalHours + ':' + window,
                payload: { scheduled: true },
                runAt: now,
                expiresAt: new Date(now.getTime() + 21600000),
            });
        } catch {
            console.warn('Snapshot reservation deferred');
        }
    }
    const jobs = await db.durableJob.findMany({
        where: {
            kind: 'snapshot-capture',
            state: { in: ['DELIVERED', 'CANCELLED', 'FAILED'] },
            createdAt: { lt: new Date(now.getTime() - 30 * 86400000) },
        },
        take: 100,
        select: { id: true },
    });
    for (const job of jobs)
        await db.$transaction(async (tx) => {
            await tx.jobAttempt.deleteMany({ where: { jobId: job.id } });
            await tx.durableJob.deleteMany({
                where: {
                    id: job.id,
                    state: { in: ['DELIVERED', 'CANCELLED', 'FAILED'] },
                },
            });
        });
}
export const snapshotCommand = new SlashCommandBuilder()
    .setName('snapshot')
    .setDescription('Capture and export versioned server structure')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
        s
            .setName('create')
            .setDescription('Capture roles, channels and permission overwrites')
            .addBooleanOption((o) =>
                o
                    .setName('template')
                    .setDescription(
                        'Retain as a reusable template within the retention period'
                    )
            )
    )
    .addSubcommand((s) =>
        s.setName('list').setDescription('List retained snapshots')
    )
    .addSubcommand((s) =>
        s
            .setName('export')
            .setDescription('Download a snapshot manifest')
            .addStringOption((o) =>
                o.setName('id').setDescription('Snapshot ID').setRequired(true)
            )
    );
export async function routeSnapshot(interaction: Interaction) {
    if (
        !interaction.isChatInputCommand() ||
        interaction.commandName !== 'snapshot'
    )
        return false;
    await interaction.deferReply({ flags: 64 });
    if (!interaction.guildId) throw new Error('Server command required');
    const guildId = interaction.guildId,
        actorId = interaction.user.id;
    await recoveryGuild(interaction.client, guildId, actorId);
    const action = interaction.options.getSubcommand();
    if (action === 'create') {
        const snapshot = await captureSnapshot(
            interaction.client,
            guildId,
            actorId,
            interaction.id,
            interaction.options.getBoolean('template') ? 'TEMPLATE' : 'MANUAL'
        );
        await interaction.editReply(
            `Snapshot captured: ${snapshot.id}. Export it with /snapshot export. This contains structure, not messages or member accounts.`
        );
    }
    if (action === 'list') {
        const snapshots = await db.serverSnapshot.findMany({
            where: { guildId, expiresAt: { gt: new Date() } },
            orderBy: { createdAt: 'desc' },
            take: 10,
        });
        await interaction.editReply(
            snapshots.length
                ? snapshots
                      .map(
                          (snapshot) =>
                              `${snapshot.id}: ${snapshot.kind}, ${snapshot.createdAt.toISOString()}, expires ${snapshot.expiresAt.toISOString()}`
                      )
                      .join('\n')
                : 'No retained snapshots.'
        );
    }
    if (action === 'export') {
        const exported = await exportSnapshot(
            guildId,
            interaction.options.getString('id', true)
        );
        await interaction.editReply({
            content:
                'Versioned server structure manifest. Protect this export: channel names and permission assignments may be private.',
            files: [
                new AttachmentBuilder(
                    Buffer.from(JSON.stringify(exported, null, 2)),
                    { name: 'backline-' + guildId + '-snapshot-v1.json' }
                ),
            ],
        });
    }
    return true;
}
