import { createHash } from 'node:crypto';

import { DurableJob, Prisma, RecoveryMapping } from '@prisma/client';
import {
    ChannelType,
    Client,
    Guild,
    GuildChannelCreateOptions,
    GuildChannelEditOptions,
    Interaction,
    PermissionFlagsBits,
    PermissionsBitField,
    SlashCommandBuilder,
} from 'discord.js';
import { z } from 'zod';

import { db } from '../db';
import { authorizeGuild } from '../guilds/authorization';
import { JobHandler } from '../jobs/store';

import { recoveryConfig, structureSchema } from './config';
import { collectStructure, exportSnapshot, recoveryGuild } from './snapshots';

type Structure = z.infer<typeof structureSchema>;
const hash = (value: unknown) =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const structureHash = (value: Structure) =>
    hash({ ...value, capturedAt: '' });
const operationSchema = z
    .object({
        kind: z.enum(['role', 'channel']),
        sourceId: z.string(),
        targetId: z.string().nullable(),
        action: z.enum(['CREATE', 'UPDATE', 'UNCHANGED', 'SKIP']),
        selected: z.boolean(),
        status: z.enum(['READY', 'DONE', 'HELD']),
        reason: z.string(),
        before: z.json().nullable().default(null),
        after: z.json().nullable().default(null),
    })
    .strict();
const operationsSchema = z.array(operationSchema).max(1000);
type Operation = z.infer<typeof operationSchema>;
const allowedRoleBits = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak,
    PermissionFlagsBits.UseVAD,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.UseExternalEmojis,
    PermissionFlagsBits.UseExternalStickers,
    PermissionFlagsBits.UseApplicationCommands,
    PermissionFlagsBits.Stream,
    PermissionFlagsBits.SendMessagesInThreads,
].reduce((mask, bit) => mask | bit, BigInt(0));
const supportedChannels = new Set<number>([
    ChannelType.GuildCategory,
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildVoice,
]);
const roleValues = (role: Structure['roles'][number]) => ({
    name: role.name,
    color: role.color,
    permissions: role.permissions,
    hoist: role.hoist,
    mentionable: role.mentionable,
});
function channelValues(
    channel: Structure['channels'][number],
    map: Map<string, string>,
    botId: string,
    maintainBot = true
) {
    const overwrites = channel.overwrites.map((row) => ({
        ...row,
        id: row.type === 0 ? (map.get('role:' + row.id) ?? row.id) : row.id,
    }));
    const control =
        PermissionFlagsBits.ViewChannel |
        PermissionFlagsBits.ManageChannels |
        PermissionFlagsBits.SendMessages |
        PermissionFlagsBits.ReadMessageHistory;
    const bot = overwrites.find((row) => row.id === botId && row.type === 1);
    if (maintainBot && bot) {
        bot.allow = (BigInt(bot.allow) | control).toString();
        bot.deny = (BigInt(bot.deny) & ~control).toString();
    } else if (maintainBot)
        overwrites.push({
            id: botId,
            type: 1,
            allow: control.toString(),
            deny: '0',
        });
    return {
        name: channel.name,
        parentId: channel.parentId
            ? (map.get('channel:' + channel.parentId) ?? channel.parentId)
            : null,
        topic: channel.topic,
        nsfw: channel.nsfw,
        bitrate: channel.bitrate,
        userLimit: channel.userLimit,
        rateLimitPerUser: channel.rateLimitPerUser,
        overwrites: overwrites.sort((a, b) => a.id.localeCompare(b.id)),
    };
}
export function buildRestoreOperations(
    source: Structure,
    live: Structure,
    selected: string[],
    mappings: Pick<RecoveryMapping, 'kind' | 'sourceId' | 'targetId'>[],
    botId: string,
    botPosition: number,
    protectedChannels: string[],
    protectedRoles: string[]
) {
    if (source.guildId !== live.guildId)
        throw new Error('Snapshot belongs to another server');
    if (
        selected.length > 20 ||
        new Set(selected).size !== selected.length ||
        selected.some(
            (id) =>
                !source.roles.some((role) => role.id === id) &&
                !source.channels.some((channel) => channel.id === id)
        )
    )
        throw new Error('Select up to twenty known resource IDs');
    const map = new Map<string, string>();
    for (const role of live.roles) map.set('role:' + role.id, role.id);
    for (const channel of live.channels)
        map.set('channel:' + channel.id, channel.id);
    for (const mapping of mappings)
        if (
            (mapping.kind === 'role' ? live.roles : live.channels).some(
                (row) => row.id === mapping.targetId
            )
        )
            map.set(mapping.kind + ':' + mapping.sourceId, mapping.targetId);
    const operations: Operation[] = [];
    for (const role of [...source.roles].sort(
        (a, b) => a.position - b.position
    )) {
        const targetId = map.get('role:' + role.id) ?? null,
            target = live.roles.find((row) => row.id === targetId);
        let action: Operation['action'] = target
                ? hash(roleValues(role)) === hash(roleValues(target))
                    ? 'UNCHANGED'
                    : 'UPDATE'
                : 'CREATE',
            reason = '';
        if (
            role.id === source.guildId ||
            role.managed ||
            (BigInt(role.permissions) & ~allowedRoleBits) !== BigInt(0) ||
            protectedRoles.includes(role.id) ||
            target?.managed ||
            (target &&
                ((BigInt(target.permissions) & ~allowedRoleBits) !==
                    BigInt(0) ||
                    target.position >= botPosition)) ||
            (targetId && protectedRoles.includes(targetId))
        ) {
            action = 'SKIP';
            reason =
                'Everyone, managed, privileged, protected or above-bot role';
        }
        operations.push({
            kind: 'role',
            before: target
                ? {
                      ...roleValues(target),
                      permissionNames: new PermissionsBitField(
                          BigInt(target.permissions)
                      ).toArray(),
                  }
                : null,
            after: {
                ...roleValues(role),
                permissionNames: new PermissionsBitField(
                    BigInt(role.permissions)
                ).toArray(),
            },
            sourceId: role.id,
            targetId,
            action,
            selected: selected.includes(role.id),
            status: 'READY',
            reason,
        });
        if (action === 'CREATE' && selected.includes(role.id))
            map.set('role:' + role.id, role.id);
    }
    for (const channel of [...source.channels].sort(
        (a, b) =>
            (a.type === Number(ChannelType.GuildCategory) ? -1 : 0) -
                (b.type === Number(ChannelType.GuildCategory) ? -1 : 0) ||
            a.position - b.position
    )) {
        const targetId = map.get('channel:' + channel.id) ?? null,
            target = live.channels.find((row) => row.id === targetId);
        let action: Operation['action'] = target
                ? hash(channelValues(channel, map, botId)) ===
                  hash(channelValues(target, new Map(), botId, false))
                    ? 'UNCHANGED'
                    : 'UPDATE'
                : 'CREATE',
            reason = '';
        if (
            !supportedChannels.has(channel.type) ||
            (target && target.type !== channel.type) ||
            protectedChannels.includes(channel.id) ||
            (targetId && protectedChannels.includes(targetId))
        ) {
            action = 'SKIP';
            reason = 'Protected channel or unsupported channel type change';
        } else if (
            (channel.parentId && !map.has('channel:' + channel.parentId)) ||
            channel.overwrites.some(
                (row) => row.type === 0 && !map.has('role:' + row.id)
            )
        ) {
            action = 'SKIP';
            reason =
                'Select missing parent/roles or supply a verified mapping; overwrites cannot be dropped';
        }
        operations.push({
            kind: 'channel',
            before: target
                ? channelValues(target, new Map(), botId, false)
                : null,
            after: channelValues(channel, map, botId),
            sourceId: channel.id,
            targetId,
            action,
            selected: selected.includes(channel.id),
            status: 'READY',
            reason,
        });
        if (action === 'CREATE' && selected.includes(channel.id))
            map.set('channel:' + channel.id, channel.id);
    }
    return operations;
}
async function configFor(guildId: string) {
    const settings = await db.guildModuleConfig.findUniqueOrThrow({
        where: { guildId_moduleId: { guildId, moduleId: 'recovery' } },
    });
    return recoveryConfig.parse(settings.config);
}
async function ownerGuild(client: Client, guildId: string, actorId: string) {
    const guild = await recoveryGuild(client, guildId, actorId);
    if (guild.ownerId !== actorId)
        throw new Error(
            'Only the current server owner can apply or map a restore'
        );
    const bot = await guild.members.fetchMe({ force: true });
    if (
        !bot.permissions.has([
            PermissionFlagsBits.ManageRoles,
            PermissionFlagsBits.ManageChannels,
        ])
    )
        throw new Error('Bot needs Manage Roles and Manage Channels');
    return { guild, bot };
}
function protectedChannels(
    guild: Guild,
    config: z.infer<typeof recoveryConfig>,
    invocationChannelId?: string
) {
    return [
        ...config.protectedChannelIds,
        ...[
            guild.rulesChannelId,
            guild.publicUpdatesChannelId,
            guild.systemChannelId,
            guild.safetyAlertsChannelId,
            invocationChannelId,
        ].filter((id): id is string => !!id),
    ];
}
export async function previewRestore(
    client: Client,
    guildId: string,
    actorId: string,
    snapshotId: string,
    requestId: string,
    selected: string[],
    invocationChannelId?: string
) {
    const guild = await recoveryGuild(client, guildId, actorId),
        bot = await guild.members.fetchMe({ force: true }),
        source = (await exportSnapshot(guildId, snapshotId)).manifest,
        live = (await collectStructure(guild)).manifest,
        config = await configFor(guildId),
        mappings = await db.recoveryMapping.findMany({
            where: { guildId },
            take: 1000,
        });
    const operations = buildRestoreOperations(
        source,
        live,
        selected,
        mappings,
        bot.id,
        bot.roles.highest.position,
        protectedChannels(guild, config, invocationChannelId),
        config.protectedRoleIds
    );
    if (Buffer.byteLength(JSON.stringify({ source, operations })) > 3000000)
        throw new Error('Restore preview exceeds storage limit');
    const memberIds = [
        ...new Set(
            source.channels
                .filter((channel) => selected.includes(channel.id))
                .flatMap((channel) =>
                    channel.overwrites
                        .filter((row) => row.type === 1 && row.id !== bot.id)
                        .map((row) => row.id)
                )
        ),
    ];
    const missing = new Set<string>();
    if (memberIds.length > 50) memberIds.forEach((id) => missing.add(id));
    else
        await Promise.all(
            memberIds.map(async (id) => {
                try {
                    await guild.members.fetch({ user: id, force: true });
                } catch {
                    missing.add(id);
                }
            })
        );
    for (const operation of operations)
        if (
            operation.kind === 'channel' &&
            source.channels
                .find((channel) => channel.id === operation.sourceId)
                ?.overwrites.some(
                    (row) => row.type === 1 && missing.has(row.id)
                )
        ) {
            operation.action = 'SKIP';
            operation.reason =
                'Unresolved member overwrite or member validation limit; overwrites cannot be dropped';
        }
    return db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
        );
        const previous = await tx.restorePlan.findUnique({
            where: { guildId_requestId: { guildId, requestId } },
        });
        if (previous) {
            if (previous.actorId !== actorId)
                throw new Error('Preview request belongs to another actor');
            return previous;
        }
        if ((await tx.restorePlan.count({ where: { guildId } })) >= 20)
            throw new Error('Restore plan capacity reached');
        return tx.restorePlan.create({
            data: {
                guildId,
                actorId,
                snapshotId,
                requestId,
                manifest: source,
                operations,
                expectedHash: structureHash(live),
                configHash: hash(config),
                expiresAt: new Date(Date.now() + 900000),
            },
        });
    });
}
export async function queueRestore(
    client: Client,
    guildId: string,
    actorId: string,
    id: string,
    confirmation: string
) {
    const { guild } = await ownerGuild(client, guildId, actorId);
    if (confirmation !== `RESTORE ${guildId} ${id}`)
        throw new Error(
            'Confirm the exact preview using RESTORE <server ID> <preview ID>'
        );
    const live = await collectStructure(guild),
        config = await configFor(guildId);
    return db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
        );
        const plan = await tx.restorePlan.findFirstOrThrow({
            where: { id, guildId },
        });
        if (
            !['PREVIEW', 'PAUSED'].includes(plan.state) ||
            plan.expiresAt <= new Date() ||
            plan.expectedHash !== structureHash(live.manifest) ||
            plan.configHash !== hash(config)
        )
            throw new Error(
                'Preview is stale, busy or held; refresh before applying'
            );
        if (plan.attempts >= 5)
            throw new Error('Restore attempt limit reached');
        if (
            !operationsSchema
                .parse(plan.operations)
                .some(
                    (op) =>
                        op.selected &&
                        op.status === 'READY' &&
                        ['CREATE', 'UPDATE'].includes(op.action)
                )
        )
            throw new Error('Preview has no selected changes');
        if (
            (await tx.durableJob.count({
                where: {
                    guildId,
                    state: { in: ['PENDING', 'LEASED', 'RECONCILE'] },
                },
            })) >= 1000
        )
            throw new Error('Server job capacity reached');
        const attempt = plan.attempts + 1;
        await tx.restorePlan.update({
            where: { id },
            data: { state: 'QUEUED', actorId, attempts: attempt },
        });
        return tx.durableJob.create({
            data: {
                guildId,
                actorId,
                moduleId: 'recovery',
                kind: 'restore-apply',
                idempotencyKey: 'restore:' + id + ':' + attempt,
                payload: { planId: id },
                runAt: new Date(),
                expiresAt: plan.expiresAt,
            },
        });
    });
}
export async function mapRecoveryResource(
    client: Client,
    guildId: string,
    actorId: string,
    kind: 'role' | 'channel',
    sourceId: string,
    targetId: string
) {
    const { guild } = await ownerGuild(client, guildId, actorId);
    z.string()
        .regex(/^\d{17,20}$/)
        .parse(sourceId);
    z.string()
        .regex(/^\d{17,20}$/)
        .parse(targetId);
    const target =
        kind === 'role'
            ? await guild.roles.fetch(targetId)
            : await guild.channels.fetch(targetId);
    if (!target) throw new Error('Mapping target unavailable');
    return db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
        );
        if (
            (await tx.recoveryMapping.count({ where: { guildId } })) >= 1000 &&
            !(await tx.recoveryMapping.findUnique({
                where: { guildId_kind_sourceId: { guildId, kind, sourceId } },
            }))
        )
            throw new Error('Mapping capacity reached');
        return tx.recoveryMapping.upsert({
            where: { guildId_kind_sourceId: { guildId, kind, sourceId } },
            create: { guildId, kind, sourceId, targetId },
            update: { targetId },
        });
    });
}

const previewJobPayload = z
    .object({
        snapshotId: z.string().uuid(),
        requestId: z.string().uuid(),
        selected: z.array(z.string().regex(/^\d{17,20}$/)).max(20),
        discordId: z.string().regex(/^\d{17,20}$/),
    })
    .strict();
const mapJobPayload = z
    .object({
        kind: z.enum(['role', 'channel']),
        sourceId: z.string().regex(/^\d{17,20}$/),
        targetId: z.string().regex(/^\d{17,20}$/),
        discordId: z.string().regex(/^\d{17,20}$/),
    })
    .strict();
const applyRequestPayload = z
    .object({
        planId: z.string().uuid(),
        confirmation: z.string().max(200),
        discordId: z.string().regex(/^\d{17,20}$/),
    })
    .strict();
async function authorizeTransport(job: DurableJob, discordId: string) {
    const account = await db.user.findUnique({
        where: { id: job.actorId },
        select: { discordId: true, role: true },
    });
    return (
        !!account &&
        account.discordId === discordId &&
        account.role !== 'BANNED' &&
        (await authorizeGuild(job.actorId, job.guildId))
    );
}

export function restorePreviewHandler(client: Client): JobHandler {
    return {
        authorize: async (job) =>
            authorizeTransport(
                job,
                previewJobPayload.parse(job.payload).discordId
            ),
        execute: async (job) => {
            const payload = previewJobPayload.parse(job.payload);
            if (!(await authorizeTransport(job, payload.discordId)))
                return {
                    state: 'CANCELLED',
                    reason: 'Current application authorization required',
                };
            const plan = await previewRestore(
                client,
                job.guildId,
                payload.discordId,
                payload.snapshotId,
                payload.requestId,
                payload.selected
            );
            return { state: 'DELIVERED', result: { planId: plan.id } };
        },
        reconcile: () =>
            Promise.resolve({
                state: 'RECONCILE',
                reason: 'Preview outcome requires inspection',
            }),
    };
}
export function restoreMapHandler(client: Client): JobHandler {
    return {
        authorize: async (job) =>
            authorizeTransport(job, mapJobPayload.parse(job.payload).discordId),
        execute: async (job) => {
            const payload = mapJobPayload.parse(job.payload);
            if (!(await authorizeTransport(job, payload.discordId)))
                return {
                    state: 'CANCELLED',
                    reason: 'Current application authorization required',
                };
            const mapping = await mapRecoveryResource(
                client,
                job.guildId,
                payload.discordId,
                payload.kind,
                payload.sourceId,
                payload.targetId
            );
            return { state: 'DELIVERED', result: { mappingId: mapping.id } };
        },
        reconcile: () =>
            Promise.resolve({
                state: 'RECONCILE',
                reason: 'Mapping outcome requires inspection',
            }),
    };
}
export function restoreApplyRequestHandler(client: Client): JobHandler {
    return {
        authorize: async (job) =>
            authorizeTransport(
                job,
                applyRequestPayload.parse(job.payload).discordId
            ),
        execute: async (job) => {
            const payload = applyRequestPayload.parse(job.payload);
            if (!(await authorizeTransport(job, payload.discordId)))
                return {
                    state: 'CANCELLED',
                    reason: 'Current application authorization required',
                };
            const queued = await queueRestore(
                client,
                job.guildId,
                payload.discordId,
                payload.planId,
                payload.confirmation
            );
            return { state: 'DELIVERED', result: { jobId: queued.id } };
        },
        reconcile: () =>
            Promise.resolve({
                state: 'RECONCILE',
                reason: 'Apply request outcome requires inspection',
            }),
    };
}

function channelOptions(
    source: Structure['channels'][number],
    map: Map<string, string>,
    botId: string
): GuildChannelEditOptions {
    const values = channelValues(source, map, botId);
    const options: GuildChannelEditOptions = {
        name: values.name,
        parent: values.parentId,
        permissionOverwrites: values.overwrites.map((row) => ({
            id: row.id,
            type: row.type,
            allow: BigInt(row.allow),
            deny: BigInt(row.deny),
        })),
        reason: 'Backline owner-confirmed selective restore',
    };
    if (
        source.type === Number(ChannelType.GuildText) ||
        source.type === Number(ChannelType.GuildAnnouncement)
    )
        Object.assign(options, {
            topic: values.topic,
            nsfw: values.nsfw,
            rateLimitPerUser: values.rateLimitPerUser,
        });
    if (source.type === Number(ChannelType.GuildVoice))
        Object.assign(options, {
            bitrate: values.bitrate ?? 64000,
            userLimit: values.userLimit ?? 0,
        });
    if (source.type === Number(ChannelType.GuildCategory))
        delete options.parent;
    return options;
}
export function restoreApplyHandler(client: Client): JobHandler {
    const planId = (job: DurableJob) =>
        z.object({ planId: z.string().uuid() }).strict().parse(job.payload)
            .planId;
    return {
        authorize: async (job) => {
            await ownerGuild(client, job.guildId, job.actorId);
            const plan = await db.restorePlan.findFirst({
                where: {
                    id: planId(job),
                    guildId: job.guildId,
                    actorId: job.actorId,
                },
            });
            return (
                !!plan &&
                ['QUEUED', 'RUNNING'].includes(plan.state) &&
                plan.expiresAt > new Date()
            );
        },
        execute: async (job) => {
            const id = planId(job);
            for (let index = 0; index < 21; index++) {
                const { guild, bot } = await ownerGuild(
                    client,
                    job.guildId,
                    job.actorId
                );
                const outcome = await db.$transaction(
                    async (tx) => {
                        await tx.$queryRaw(
                            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${job.guildId})::bigint)::text`
                        );
                        const plan = await tx.restorePlan.findFirstOrThrow({
                            where: {
                                id,
                                guildId: job.guildId,
                                actorId: job.actorId,
                            },
                        });
                        if (plan.state === 'COMPLETED')
                            return {
                                state: 'DELIVERED' as const,
                                result: { planId: id },
                            };
                        if (
                            !['QUEUED', 'RUNNING'].includes(plan.state) ||
                            plan.expiresAt <= new Date()
                        )
                            return {
                                state: 'CANCELLED' as const,
                                reason: 'Restore unavailable, held or expired',
                            };
                        const settings =
                                await tx.guildModuleConfig.findUniqueOrThrow({
                                    where: {
                                        guildId_moduleId: {
                                            guildId: job.guildId,
                                            moduleId: 'recovery',
                                        },
                                    },
                                }),
                            installation =
                                await tx.guildInstallation.findUnique({
                                    where: { guildId: job.guildId },
                                }),
                            config = recoveryConfig.parse(settings.config);
                        if (
                            !settings.enabled ||
                            !installation?.active ||
                            plan.configHash !== hash(config)
                        )
                            return {
                                state: 'CANCELLED' as const,
                                reason: 'Recovery configuration changed',
                            };
                        const live = (await collectStructure(guild)).manifest;
                        if (plan.expectedHash !== structureHash(live)) {
                            await tx.restorePlan.update({
                                where: { id },
                                data: {
                                    state: 'PAUSED',
                                    lastError:
                                        'Structure changed; refresh the preview',
                                },
                            });
                            return {
                                state: 'FAILED' as const,
                                reason: 'Structure changed; refresh the preview',
                            };
                        }
                        const source = structureSchema.parse(plan.manifest),
                            operations = operationsSchema.parse(
                                plan.operations
                            ),
                            operation = operations.find(
                                (row) =>
                                    row.selected &&
                                    row.status === 'READY' &&
                                    ['CREATE', 'UPDATE'].includes(row.action)
                            );
                        if (!operation) {
                            await tx.restorePlan.update({
                                where: { id },
                                data: { state: 'COMPLETED', lastError: null },
                            });
                            return {
                                state: 'DELIVERED' as const,
                                result: { planId: id },
                            };
                        }
                        const mappings = await tx.recoveryMapping.findMany({
                            where: { guildId: job.guildId },
                            take: 1000,
                        });
                        const check = buildRestoreOperations(
                            source,
                            live,
                            operations
                                .filter((row) => row.selected)
                                .map((row) => row.sourceId),
                            mappings,
                            bot.id,
                            bot.roles.highest.position,
                            protectedChannels(guild, config),
                            config.protectedRoleIds
                        ).find(
                            (row) =>
                                row.kind === operation.kind &&
                                row.sourceId === operation.sourceId
                        );
                        if (
                            !check ||
                            check.action === 'SKIP' ||
                            check.targetId !== operation.targetId
                        ) {
                            await tx.restorePlan.update({
                                where: { id },
                                data: {
                                    state: 'PAUSED',
                                    lastError:
                                        'Resource protection or mapping changed',
                                },
                            });
                            return {
                                state: 'FAILED' as const,
                                reason: 'Resource protection or mapping changed',
                            };
                        }
                        const map = new Map<string, string>();
                        for (const role of live.roles)
                            map.set('role:' + role.id, role.id);
                        for (const channel of live.channels)
                            map.set('channel:' + channel.id, channel.id);
                        for (const mapping of mappings)
                            map.set(
                                mapping.kind + ':' + mapping.sourceId,
                                mapping.targetId
                            );
                        if (
                            mappings.length >= 1000 &&
                            !mappings.some(
                                (mapping) =>
                                    mapping.kind === operation.kind &&
                                    mapping.sourceId === operation.sourceId
                            )
                        ) {
                            await tx.restorePlan.update({
                                where: { id },
                                data: {
                                    state: 'PAUSED',
                                    lastError: 'Mapping capacity reached',
                                },
                            });
                            return {
                                state: 'FAILED' as const,
                                reason: 'Mapping capacity reached',
                            };
                        }
                        operation.status = 'HELD';
                        try {
                            let targetId: string;
                            if (operation.kind === 'role') {
                                const role = source.roles.find(
                                    (row) => row.id === operation.sourceId
                                )!;
                                const values = {
                                    ...roleValues(role),
                                    permissions: BigInt(role.permissions),
                                    reason: 'Backline owner-confirmed selective restore',
                                };
                                if (operation.targetId) {
                                    const target = await guild.roles.fetch(
                                        operation.targetId
                                    );
                                    if (!target || !target.editable)
                                        throw new Error(
                                            'Role no longer editable'
                                        );
                                    await target.edit(values);
                                    targetId = target.id;
                                } else
                                    targetId = (
                                        await guild.roles.create(values)
                                    ).id;
                            } else {
                                const channel = source.channels.find(
                                    (row) => row.id === operation.sourceId
                                )!;
                                if (
                                    (channel.parentId &&
                                        !map.has(
                                            'channel:' + channel.parentId
                                        )) ||
                                    channel.overwrites.some(
                                        (row) =>
                                            row.type === 0 &&
                                            !map.has('role:' + row.id)
                                    )
                                )
                                    throw new Error(
                                        'Unresolved restore dependency'
                                    );
                                for (const member of channel.overwrites.filter(
                                    (row) => row.type === 1 && row.id !== bot.id
                                )) {
                                    await guild.members.fetch({
                                        user: member.id,
                                        force: true,
                                    });
                                }
                                const options = channelOptions(
                                    channel,
                                    map,
                                    bot.id
                                );
                                if (operation.targetId) {
                                    const target = await guild.channels.fetch(
                                        operation.targetId,
                                        { force: true }
                                    );
                                    if (
                                        !target ||
                                        !supportedChannels.has(target.type)
                                    )
                                        throw new Error('Channel unavailable');
                                    await target.edit(options);
                                    targetId = target.id;
                                } else
                                    targetId = (
                                        await guild.channels.create({
                                            ...options,
                                            type: channel.type,
                                            name: channel.name,
                                        } as GuildChannelCreateOptions)
                                    ).id;
                            }
                            operation.targetId = targetId;
                            operation.status = 'DONE';
                            await tx.recoveryMapping.upsert({
                                where: {
                                    guildId_kind_sourceId: {
                                        guildId: job.guildId,
                                        kind: operation.kind,
                                        sourceId: operation.sourceId,
                                    },
                                },
                                create: {
                                    guildId: job.guildId,
                                    kind: operation.kind,
                                    sourceId: operation.sourceId,
                                    targetId,
                                },
                                update: { targetId },
                            });
                            const after = (await collectStructure(guild))
                                .manifest;
                            await tx.restorePlan.update({
                                where: { id },
                                data: {
                                    state: 'RUNNING',
                                    operations,
                                    expectedHash: structureHash(after),
                                    lastError: null,
                                },
                            });
                            return undefined;
                        } catch (error) {
                            // A confirmed 4xx rejection has no successful mutation. Lost results remain held.
                            const rejected =
                                !!error &&
                                typeof error === 'object' &&
                                'status' in error &&
                                typeof error.status === 'number' &&
                                error.status >= 400 &&
                                error.status < 500 &&
                                error.status !== 429;
                            if (rejected && operation.status !== 'DONE')
                                operation.status = 'READY';
                            await tx.restorePlan.update({
                                where: { id },
                                data: {
                                    state:
                                        rejected && operation.status !== 'DONE'
                                            ? 'PAUSED'
                                            : 'HELD',
                                    operations,
                                    lastError: rejected
                                        ? 'Discord rejected the step; review permissions and resume'
                                        : 'Step outcome uncertain; inspect Discord and map any created resource before a new preview',
                                },
                            });
                            return {
                                state:
                                    rejected && operation.status !== 'DONE'
                                        ? ('FAILED' as const)
                                        : ('RECONCILE' as const),
                                reason: rejected
                                    ? 'Discord rejected a restore step'
                                    : 'Restore step outcome requires inspection',
                            };
                        }
                    },
                    { timeout: 60000 }
                );
                if (outcome) return outcome;
            }
            return { state: 'RECONCILE', reason: 'Restore step bound reached' };
        },
        reconcile: async (job) => {
            const id = planId(job),
                plan = await db.restorePlan.findFirst({
                    where: { id, guildId: job.guildId },
                });
            if (plan?.state === 'COMPLETED')
                return { state: 'DELIVERED', result: { planId: id } };
            if (plan)
                await db.restorePlan.update({
                    where: { id },
                    data: {
                        state: 'HELD',
                        lastError:
                            'Worker outcome uncertain; inspect step receipts and map any created resource before a new preview',
                    },
                });
            return {
                state: 'RECONCILE',
                reason: 'Partial restore is held; never replay uncertain creates automatically',
            };
        },
    };
}
export async function maintainRestorePlans() {
    const expired = await db.restorePlan.findMany({
        where: {
            state: { in: ['PREVIEW', 'QUEUED', 'PAUSED'] },
            expiresAt: { lte: new Date() },
        },
        take: 100,
    });
    for (const plan of expired)
        await db.$transaction(async (tx) => {
            await tx.$queryRaw(
                Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${plan.guildId})::bigint)::text`
            );
            if (
                await tx.durableJob.count({
                    where: {
                        guildId: plan.guildId,
                        kind: 'restore-apply',
                        payload: { path: ['planId'], equals: plan.id },
                        state: { in: ['LEASED', 'RECONCILE'] },
                    },
                })
            )
                return;
            await tx.restorePlan.updateMany({
                where: {
                    id: plan.id,
                    state: { in: ['PREVIEW', 'QUEUED', 'PAUSED'] },
                },
                data: { state: 'CANCELLED' },
            });
        });
    const old = await db.restorePlan.findMany({
        where: {
            state: { in: ['COMPLETED', 'CANCELLED'] },
            createdAt: { lt: new Date(Date.now() - 30 * 86400000) },
        },
        take: 100,
    });
    for (const plan of old)
        await db.$transaction(async (tx) => {
            const jobs = await tx.durableJob.findMany({
                where: {
                    guildId: plan.guildId,
                    kind: 'restore-apply',
                    payload: { path: ['planId'], equals: plan.id },
                },
                select: { id: true, state: true },
            });
            if (jobs.some((job) => ['LEASED', 'RECONCILE'].includes(job.state)))
                return;
            await tx.jobAttempt.deleteMany({
                where: { jobId: { in: jobs.map((job) => job.id) } },
            });
            await tx.durableJob.deleteMany({
                where: { id: { in: jobs.map((job) => job.id) } },
            });
            await tx.restorePlan.deleteMany({ where: { id: plan.id } });
        });
}
export const restoreCommand = new SlashCommandBuilder()
    .setName('restore')
    .setDescription('Preview and selectively apply server structure')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
        s
            .setName('preview')
            .setDescription(
                'Compare a snapshot and select up to twenty resource IDs'
            )
            .addStringOption((o) =>
                o
                    .setName('snapshot')
                    .setDescription('Snapshot ID')
                    .setRequired(true)
            )
            .addStringOption((o) =>
                o
                    .setName('resources')
                    .setDescription(
                        'Comma-separated role/channel IDs to select, or omit for comparison only'
                    )
            )
    )
    .addSubcommand((s) =>
        s
            .setName('apply')
            .setDescription(
                'Owner confirms the exact preview; no deletions are performed'
            )
            .addStringOption((o) =>
                o.setName('id').setDescription('Preview ID').setRequired(true)
            )
            .addStringOption((o) =>
                o
                    .setName('confirm')
                    .setDescription('RESTORE <server ID> <preview ID>')
                    .setRequired(true)
            )
    )
    .addSubcommand((s) =>
        s
            .setName('status')
            .setDescription('Read step receipts and current plan state')
            .addStringOption((o) =>
                o.setName('id').setDescription('Preview ID').setRequired(true)
            )
    )
    .addSubcommand((s) =>
        s
            .setName('map')
            .setDescription('Owner links a recreated resource after inspection')
            .addStringOption((o) =>
                o
                    .setName('kind')
                    .setDescription('Resource type')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Role', value: 'role' },
                        { name: 'Channel', value: 'channel' }
                    )
            )
            .addStringOption((o) =>
                o
                    .setName('source')
                    .setDescription('Original snapshot resource ID')
                    .setRequired(true)
            )
            .addStringOption((o) =>
                o
                    .setName('target')
                    .setDescription('Current resource ID')
                    .setRequired(true)
            )
    );
export async function routeRestore(interaction: Interaction) {
    if (
        !interaction.isChatInputCommand() ||
        interaction.commandName !== 'restore'
    )
        return false;
    await interaction.deferReply({ flags: 64 });
    if (!interaction.guildId) throw new Error('Server command required');
    const guildId = interaction.guildId,
        actorId = interaction.user.id;
    await recoveryGuild(interaction.client, guildId, actorId);
    const action = interaction.options.getSubcommand();
    if (action === 'preview') {
        const selected = (interaction.options.getString('resources') ?? '')
                .split(',')
                .map((id) => id.trim())
                .filter(Boolean),
            plan = await previewRestore(
                interaction.client,
                guildId,
                actorId,
                interaction.options.getString('snapshot', true),
                interaction.id,
                selected,
                interaction.channelId
            ),
            operations = operationsSchema.parse(plan.operations);
        await interaction.editReply(
            `Preview ${plan.id} expires ${plan.expiresAt.toISOString()}. Selected changes: ${operations.filter((op) => op.selected && ['CREATE', 'UPDATE'].includes(op.action)).length}; protected/skipped: ${operations.filter((op) => op.action === 'SKIP').length}; deletions: 0. Bot access is maintained in restored channels. Review full operations in the dashboard or /restore status before the owner confirms RESTORE ${guildId} ${plan.id}.`
        );
    }
    if (action === 'apply') {
        const job = await queueRestore(
            interaction.client,
            guildId,
            actorId,
            interaction.options.getString('id', true),
            interaction.options.getString('confirm', true)
        );
        await interaction.editReply(
            `Restore queued: ${job.id}. Read /restore status for confirmed step receipts; queueing does not prove application.`
        );
    }
    if (action === 'status') {
        const plan = await db.restorePlan.findFirstOrThrow({
                where: {
                    id: interaction.options.getString('id', true),
                    guildId,
                },
            }),
            operations = operationsSchema.parse(plan.operations);
        await interaction.editReply(
            `${plan.id}: ${plan.state}\n${operations
                .filter((op) => op.selected || op.action === 'SKIP')
                .slice(0, 15)
                .map(
                    (op) =>
                        `${op.kind} ${op.sourceId}: ${op.action}, ${op.status}, target ${op.targetId ?? 'unmapped'} ${op.reason}`
                )
                .join('\n')
                .slice(0, 1700)}\n${plan.lastError ?? ''}`
        );
    }
    if (action === 'map') {
        await mapRecoveryResource(
            interaction.client,
            guildId,
            actorId,
            interaction.options.getString('kind', true) as 'role' | 'channel',
            interaction.options.getString('source', true),
            interaction.options.getString('target', true)
        );
        await interaction.editReply(
            'Verified ID mapping saved. Create a fresh preview before applying remaining work.'
        );
    }
    return true;
}
