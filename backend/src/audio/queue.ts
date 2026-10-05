import { randomInt, randomUUID } from 'node:crypto';

import { AudioQueue, DurableJob, Prisma } from '@prisma/client';
import { Client, Interaction, SlashCommandBuilder } from 'discord.js';
import { z } from 'zod';

import { db } from '../db';
import { authorizeGuild } from '../guilds/authorization';
import { JobHandler } from '../jobs/store';

import { stationId } from './config';
import { audioAccess, audioSettings, radioRuntime } from './radio';

export const queueItem = z
    .object({
        id: z.string().uuid(),
        station: stationId.optional(),
        clipId: z.string().uuid().optional(),
        minutes: z.number().int().min(1).max(30),
        requesterId: z.string().regex(/^\d{17,20}$/),
        channelId: z.string().regex(/^\d{17,20}$/),
    })
    .strict()
    .refine(
        (item) => Boolean(item.station) !== Boolean(item.clipId),
        'One approved source required'
    );
export const queueItems = z.array(queueItem).max(50);
const playlistName = z
    .string()
    .trim()
    .regex(/^[\p{L}\p{N} _-]{1,40}$/u);
async function locked<T>(
    guildId: string,
    fn: (tx: Prisma.TransactionClient, row: AudioQueue) => Promise<T>
): Promise<T> {
    return db.$transaction(
        async (tx) => {
            await tx.$queryRaw(
                Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
            );
            const row = await tx.audioQueue.upsert({
                where: { guildId },
                create: { guildId },
                update: {},
            });
            return fn(tx, row);
        },
        { maxWait: 10000, timeout: 10000 }
    );
}
export async function enqueue(
    client: Client,
    guildId: string,
    actorId: string,
    station: string,
    minutes: number,
    requestId: string = randomUUID()
) {
    const access = await audioAccess(client, guildId, actorId);
    if (!access.config.queuesEnabled) throw new Error('Queues disabled');
    const current = radioRuntime.status(guildId);
    if (current && current.channelId !== access.channelId)
        throw new Error('Join the current audio channel');
    const item = queueItem.parse({
        id: requestId,
        station,
        minutes,
        requesterId: actorId,
        channelId: access.channelId,
    });
    return locked(guildId, async (tx, row) => {
        const settings = await tx.guildModuleConfig.findUnique({
            where: { guildId_moduleId: { guildId, moduleId: 'audio' } },
        });
        if (
            !settings?.enabled ||
            !settings.config ||
            !(settings.config as Record<string, unknown>).queuesEnabled
        )
            throw new Error('Queues disabled');
        const items = queueItems.parse(row.items);
        if (items.some((entry) => entry.id === requestId)) return row;
        if (
            items.length >= 50 ||
            items.filter((i) => i.requesterId === actorId).length >= 10
        )
            throw new Error(
                'Queue capacity reached (fifty total, ten per member)'
            );
        items.push(item);
        return tx.audioQueue.update({ where: { guildId }, data: { items } });
    });
}

const dashboardAudioAction = z.discriminatedUnion('action', [
    z
        .object({
            action: z.literal('enqueue'),
            station: stationId,
            minutes: z.number().int().min(1).max(30),
            discordId: z.string().regex(/^\d{17,20}$/),
            requestId: z.string().uuid(),
        })
        .strict(),
    z
        .object({
            action: z.literal('start'),
            discordId: z.string().regex(/^\d{17,20}$/),
            requestId: z.string().uuid(),
        })
        .strict(),
    z
        .object({
            action: z.literal('control'),
            control: z.enum(['pause', 'resume', 'skip', 'stop']),
            discordId: z.string().regex(/^\d{17,20}$/),
            requestId: z.string().uuid(),
        })
        .strict(),
    z
        .object({
            action: z.literal('volume'),
            volume: z.number().int().min(0).max(100),
            discordId: z.string().regex(/^\d{17,20}$/),
            requestId: z.string().uuid(),
        })
        .strict(),
    z
        .object({
            action: z.literal('queue-setting'),
            setting: z.enum(['shuffle', 'loop', 'clear']),
            enabled: z.boolean().optional(),
            discordId: z.string().regex(/^\d{17,20}$/),
            requestId: z.string().uuid(),
        })
        .strict(),
    z
        .object({
            action: z.literal('playlist'),
            operation: z.enum(['save', 'load', 'delete']),
            name: playlistName,
            discordId: z.string().regex(/^\d{17,20}$/),
            requestId: z.string().uuid(),
        })
        .strict(),
]);

async function dashboardActor(
    job: DurableJob,
    discordId: string
): Promise<boolean> {
    const account = await db.user.findUnique({
        where: { id: job.actorId },
        select: { discordId: true, role: true },
    });
    return (
        !!account &&
        account.role !== 'BANNED' &&
        account.discordId === discordId
    );
}

/** API requests are durable work; only the Gateway worker touches voice state. */
export function audioDashboardHandler(client: Client): JobHandler {
    return {
        authorize: async (job) => {
            const payload = dashboardAudioAction.parse(job.payload);
            return (
                (await dashboardActor(job, payload.discordId)) &&
                (await authorizeGuild(job.actorId, job.guildId))
            );
        },
        execute: async (job) => {
            const payload = dashboardAudioAction.parse(job.payload);
            if (
                !(await dashboardActor(job, payload.discordId)) ||
                !(await authorizeGuild(job.actorId, job.guildId))
            )
                return {
                    state: 'CANCELLED',
                    reason: 'Dashboard authorization changed',
                };
            if (payload.action === 'enqueue')
                await enqueue(
                    client,
                    job.guildId,
                    payload.discordId,
                    payload.station,
                    payload.minutes,
                    job.id
                );
            else if (payload.action === 'start')
                await startQueue(client, job.guildId, payload.discordId);
            else if (payload.action === 'control') {
                if (payload.control === 'stop') {
                    const access = await audioAccess(
                        client,
                        job.guildId,
                        payload.discordId
                    );
                    const playback = radioRuntime.status(job.guildId);
                    if (playback && playback.channelId !== access.channelId)
                        throw new Error('Join the current audio channel');
                    await radioRuntime.authorizedStop(
                        client,
                        job.guildId,
                        payload.discordId
                    );
                } else
                    await radioRuntime.control(
                        client,
                        job.guildId,
                        payload.discordId,
                        payload.control
                    );
            } else if (payload.action === 'volume')
                await radioRuntime.control(
                    client,
                    job.guildId,
                    payload.discordId,
                    'volume',
                    payload.volume
                );
            else if (payload.action === 'queue-setting')
                await queueSettings(
                    client,
                    job.guildId,
                    payload.discordId,
                    payload.setting,
                    payload.enabled
                );
            else if (payload.operation === 'save')
                await savePlaylist(
                    client,
                    job.guildId,
                    payload.discordId,
                    payload.name
                );
            else if (payload.operation === 'load')
                await loadPlaylist(
                    client,
                    job.guildId,
                    payload.discordId,
                    payload.name
                );
            else {
                await audioAccess(client, job.guildId, payload.discordId, true);
                await db.audioPlaylist.deleteMany({
                    where: { guildId: job.guildId, name: payload.name },
                });
            }
            return { state: 'DELIVERED', result: { action: payload.action } };
        },
        reconcile: async (job) => {
            const payload = dashboardAudioAction.parse(job.payload);
            if (payload.action === 'enqueue') {
                const queue = await db.audioQueue.findUnique({
                    where: { guildId: job.guildId },
                });
                if (
                    queue &&
                    queueItems
                        .parse(queue.items)
                        .some((item) => item.id === job.id)
                )
                    return {
                        state: 'DELIVERED',
                        result: { action: payload.action },
                    };
            }
            return {
                state: 'RECONCILE',
                reason: 'Audio action outcome requires current queue inspection',
            };
        },
    };
}
export async function claimQueue(guildId: string) {
    return locked(guildId, async (tx, row) => {
        if (row.state === 'STARTING' || row.state === 'PLAYING')
            throw new Error('Queue already claimed');
        const items = queueItems.parse(row.items);
        if (!items.length) return null;
        if (row.shuffle && items.length > 1) {
            const index = randomInt(items.length);
            [items[0], items[index]] = [items[index], items[0]];
        }
        const claimId = randomUUID();
        return tx.audioQueue.update({
            where: { guildId },
            data: {
                items,
                state: 'STARTING',
                claimId,
                leaseUntil: new Date(Date.now() + 120000),
            },
        });
    });
}
export async function finishQueue(
    guildId: string,
    claimId: string,
    completed: boolean
) {
    return locked(guildId, async (tx, row) => {
        if (row.claimId !== claimId) return null;
        const items = queueItems.parse(row.items);
        if (completed) {
            const item = items.shift();
            if (item && row.loop) items.push(item);
        }
        return tx.audioQueue.update({
            where: { guildId },
            data: {
                items,
                state: completed ? 'IDLE' : 'INTERRUPTED',
                claimId: null,
                leaseUntil: null,
            },
        });
    });
}
export async function recoverQueues(now = new Date()) {
    await db.audioQueue.updateMany({
        where: {
            state: { in: ['STARTING', 'PLAYING'] },
            leaseUntil: { lt: now },
        },
        data: { state: 'INTERRUPTED', claimId: null, leaseUntil: null },
    });
}
const active = new Map<
        string,
        {
            claimId: string;
            playbackId: string;
            controllerId: string;
            deadline: number;
            channelId: string;
        }
    >(),
    starting = new Set<string>();
export async function startQueue(
    client: Client,
    guildId: string,
    actorId: string,
    deadline?: number,
    expectedChannel?: string
) {
    const access = await audioAccess(client, guildId, actorId, true);
    if (!access.config.queuesEnabled) throw new Error('Queues disabled');
    if (expectedChannel && access.channelId !== expectedChannel)
        throw new Error('Queue requester left its voice channel');
    deadline ??= Date.now() + access.config.maxMinutes * 60000;
    if (Date.now() >= deadline) throw new Error('Queue duration limit reached');
    if (starting.has(guildId) || radioRuntime.status(guildId))
        throw new Error('Playback already active');
    starting.add(guildId);
    let row: AudioQueue | null = null;
    try {
        row = await claimQueue(guildId);
        if (!row) return;
        const item = queueItems.parse(row.items)[0];
        // A playlist is started under current DJ authority, never under its saved creator's authority.
        const result = await radioRuntime.play(
            client,
            guildId,
            actorId,
            item.station,
            access.channelId,
            Math.min(
                item.minutes,
                Math.max(1, Math.ceil((deadline - Date.now()) / 60000))
            ),
            item.clipId
        );
        if (!result) throw new Error('Playback unavailable');
        const marked = await db.audioQueue.updateMany({
            where: { guildId, claimId: row.claimId, state: 'STARTING' },
            data: {
                state: 'PLAYING',
                leaseUntil: new Date(Date.now() + 120000),
            },
        });
        if (!marked.count) {
            await radioRuntime.stop(
                guildId,
                'Queue claim lost',
                'STOPPED',
                result.id
            );
            throw new Error('Queue claim lost');
        }
        active.set(guildId, {
            claimId: row.claimId!,
            playbackId: result.id,
            // Queue entries belong to their requesters, but continuation must
            // remain under the DJ who explicitly started this queue.
            controllerId: actorId,
            deadline,
            channelId: access.channelId,
        });
    } catch (error) {
        if (row?.claimId) await finishQueue(guildId, row.claimId, false);
        throw error;
    } finally {
        starting.delete(guildId);
    }
}
export async function maintainQueues(client: Client) {
    for (const [guildId, owned] of active) {
        try {
            const settings = await audioSettings(guildId);
            if (!settings.queuesEnabled || Date.now() >= owned.deadline)
                throw new Error('Queue disabled or duration limit reached');
            const current = radioRuntime.status(guildId);
            if (current?.id === owned.playbackId) {
                const updated = await db.audioQueue.updateMany({
                    where: {
                        guildId,
                        claimId: owned.claimId,
                        state: 'PLAYING',
                    },
                    data: { leaseUntil: new Date(Date.now() + 120000) },
                });
                if (!updated.count) throw new Error('Queue claim lost');
                continue;
            }
            active.delete(guildId);
            const playback = await db.voicePlayback.findUnique({
                where: { id: owned.playbackId },
            });
            const complete =
                playback?.state === 'STOPPED' &&
                [
                    'Maximum playback duration reached',
                    'Queue skip',
                    'Clip completed',
                ].includes(playback.detail ?? '');
            await finishQueue(guildId, owned.claimId, complete);
            if (complete && playback)
                await startQueue(
                    client,
                    guildId,
                    owned.controllerId,
                    owned.deadline,
                    owned.channelId
                );
        } catch {
            active.delete(guildId);
            await radioRuntime.stop(
                guildId,
                'Queue interrupted',
                'STOPPED',
                owned.playbackId
            );
            await finishQueue(guildId, owned.claimId, false);
            await locked(guildId, async (tx, row) => {
                if (row.state === 'IDLE' && !row.claimId)
                    await tx.audioQueue.update({
                        where: { guildId },
                        data: { state: 'INTERRUPTED' },
                    });
            });
            console.warn('Audio queue interrupted; explicit restart required');
        }
    }
    await recoverQueues();
}
export async function queueSettings(
    client: Client,
    guildId: string,
    actorId: string,
    action: 'shuffle' | 'loop' | 'clear',
    enabled?: boolean
) {
    await audioAccess(client, guildId, actorId, true);
    return locked(guildId, async (tx, row) => {
        if (
            action === 'clear' &&
            (row.state === 'STARTING' || row.state === 'PLAYING')
        )
            throw new Error('Stop playback before clearing');
        return tx.audioQueue.update({
            where: { guildId },
            data:
                action === 'clear'
                    ? {
                          items: [],
                          state: 'IDLE',
                          claimId: null,
                          leaseUntil: null,
                      }
                    : action === 'shuffle'
                      ? { shuffle: enabled === true }
                      : { loop: enabled === true },
        });
    });
}
export async function savePlaylist(
    client: Client,
    guildId: string,
    actorId: string,
    name: string
) {
    await audioAccess(client, guildId, actorId, true);
    const selected = playlistName.parse(name);
    return locked(guildId, async (tx, row) => {
        const prior = await tx.audioPlaylist.findUnique({
            where: { guildId_name: { guildId, name: selected } },
        });
        if (
            !prior &&
            (await tx.audioPlaylist.count({ where: { guildId } })) >= 20
        )
            throw new Error('Twenty playlists per server');
        const items = queueItems.parse(row.items);
        if (!items.length) throw new Error('Queue is empty');
        return tx.audioPlaylist.upsert({
            where: { guildId_name: { guildId, name: selected } },
            create: { guildId, name: selected, createdBy: actorId, items },
            update: { items, createdBy: actorId },
        });
    });
}
export async function loadPlaylist(
    client: Client,
    guildId: string,
    actorId: string,
    name: string
) {
    const access = await audioAccess(client, guildId, actorId, true);
    if (!access.config.queuesEnabled) throw new Error('Queues disabled');
    return locked(guildId, async (tx, row) => {
        if (row.state === 'STARTING' || row.state === 'PLAYING')
            throw new Error('Stop before loading a playlist');
        const playlist = await tx.audioPlaylist.findUniqueOrThrow({
            where: {
                guildId_name: { guildId, name: playlistName.parse(name) },
            },
        });
        const items = queueItems.parse(playlist.items).map((i) => ({
            ...i,
            id: randomUUID(),
            requesterId: actorId,
            channelId: access.channelId,
        }));
        return tx.audioQueue.update({
            where: { guildId },
            data: { items, state: 'IDLE', claimId: null, leaseUntil: null },
        });
    });
}
export const audioCommand = new SlashCommandBuilder()
    .setName('audio')
    .setDescription('Approved radio queues and playback controls')
    .setContexts(0)
    .setIntegrationTypes(0)
    .addSubcommand((s) =>
        s
            .setName('enqueue')
            .setDescription('Queue a timed published station segment')
            .addStringOption((o) =>
                o
                    .setName('station')
                    .setDescription('SomaFM station ID')
                    .setRequired(true)
            )
            .addIntegerOption((o) =>
                o
                    .setName('minutes')
                    .setDescription('One to thirty minutes')
                    .setRequired(true)
                    .setMinValue(1)
                    .setMaxValue(30)
            )
    )
    .addSubcommand((s) =>
        s
            .setName('start')
            .setDescription('DJ: explicitly start or restart a queue')
    )
    .addSubcommand((s) =>
        s.setName('queue').setDescription('Show this server queue')
    )
    .addSubcommand((s) =>
        s.setName('pause').setDescription('Requester or DJ: pause playback')
    )
    .addSubcommand((s) =>
        s.setName('resume').setDescription('Requester or DJ: resume playback')
    )
    .addSubcommand((s) =>
        s
            .setName('skip')
            .setDescription('Requester/DJ skips; other listeners vote')
    )
    .addSubcommand((s) =>
        s
            .setName('stop')
            .setDescription('Requester or DJ: stop and retain pending entries')
    )
    .addSubcommand((s) =>
        s
            .setName('volume')
            .setDescription('Set session volume within the server limit')
            .addIntegerOption((o) =>
                o
                    .setName('value')
                    .setDescription('Zero to one hundred')
                    .setRequired(true)
                    .setMinValue(0)
                    .setMaxValue(100)
            )
    )
    .addSubcommand((s) =>
        s
            .setName('shuffle')
            .setDescription('DJ: shuffle future queue selection')
            .addBooleanOption((o) =>
                o.setName('enabled').setDescription('Enabled').setRequired(true)
            )
    )
    .addSubcommand((s) =>
        s
            .setName('loop')
            .setDescription('DJ: rotate completed entries to the end')
            .addBooleanOption((o) =>
                o.setName('enabled').setDescription('Enabled').setRequired(true)
            )
    )
    .addSubcommand((s) =>
        s.setName('clear').setDescription('DJ: clear a stopped queue')
    )
    .addSubcommand((s) =>
        s
            .setName('save')
            .setDescription('DJ: save the pending queue')
            .addStringOption((o) =>
                o
                    .setName('name')
                    .setDescription('Playlist name')
                    .setRequired(true)
                    .setMaxLength(40)
            )
    )
    .addSubcommand((s) =>
        s
            .setName('load')
            .setDescription('DJ: load a saved playlist without starting it')
            .addStringOption((o) =>
                o
                    .setName('name')
                    .setDescription('Playlist name')
                    .setRequired(true)
                    .setMaxLength(40)
            )
    )
    .addSubcommand((s) =>
        s.setName('playlists').setDescription('List this server playlists')
    )
    .addSubcommand((s) =>
        s
            .setName('delete')
            .setDescription('DJ: delete a saved playlist')
            .addStringOption((o) =>
                o
                    .setName('name')
                    .setDescription('Playlist name')
                    .setRequired(true)
                    .setMaxLength(40)
            )
    )
    .toJSON();
export async function routeAudio(interaction: Interaction) {
    if (
        !interaction.isChatInputCommand() ||
        interaction.commandName !== 'audio'
    )
        return false;
    const guildId = interaction.guildId!,
        actorId = interaction.user.id,
        client = interaction.client,
        sub = interaction.options.getSubcommand();
    try {
        if (sub === 'enqueue')
            await enqueue(
                client,
                guildId,
                actorId,
                interaction.options.getString('station', true),
                interaction.options.getInteger('minutes', true)
            );
        else if (sub === 'start') await startQueue(client, guildId, actorId);
        else if (['pause', 'resume', 'volume', 'skip'].includes(sub)) {
            const result = await radioRuntime.control(
                client,
                guildId,
                actorId,
                sub as 'pause' | 'resume' | 'volume' | 'skip',
                interaction.options.getInteger('value') ?? undefined
            );
            if (sub === 'skip' && !result.skipped) {
                await interaction.editReply(
                    `Skip votes: ${result.votes}/${result.required}.`
                );
                return true;
            }
        } else if (sub === 'stop')
            await radioRuntime.authorizedStop(client, guildId, actorId);
        else if (sub === 'shuffle' || sub === 'loop' || sub === 'clear')
            await queueSettings(
                client,
                guildId,
                actorId,
                sub,
                interaction.options.getBoolean('enabled') ?? undefined
            );
        else if (sub === 'save')
            await savePlaylist(
                client,
                guildId,
                actorId,
                interaction.options.getString('name', true)
            );
        else if (sub === 'load')
            await loadPlaylist(
                client,
                guildId,
                actorId,
                interaction.options.getString('name', true)
            );
        else {
            await audioAccess(client, guildId, actorId, sub === 'delete');
            if (sub === 'delete')
                await db.audioPlaylist.deleteMany({
                    where: {
                        guildId,
                        name: playlistName.parse(
                            interaction.options.getString('name', true)
                        ),
                    },
                });
            else if (sub === 'playlists') {
                const rows = await db.audioPlaylist.findMany({
                    where: { guildId },
                    orderBy: { name: 'asc' },
                    take: 20,
                });
                await interaction.editReply(
                    rows.map((r) => r.name).join('\n') || 'No saved playlists.'
                );
                return true;
            } else {
                const row = await db.audioQueue.findUnique({
                    where: { guildId },
                });
                const items = queueItems.parse(row?.items ?? []);
                await interaction.editReply(
                    `${row?.state ?? 'IDLE'} · ${items.length}/50 entries\n` +
                        items
                            .slice(0, 20)
                            .map(
                                (i, n) =>
                                    `${n + 1}. ${i.station ?? `clip ${i.clipId}`} · ${i.clipId ? 'up to 15 seconds' : `${i.minutes} min`}`
                            )
                            .join('\n')
                );
                return true;
            }
        }
        await interaction.editReply(
            'Audio action completed. Playback state is available with /radio status.'
        );
    } catch {
        await interaction.editReply(
            'Audio action unavailable. Check current voice membership, DJ permissions, server settings and queue state.'
        );
    }
    return true;
}

export async function enqueueSoundboard(
    client: Client,
    guildId: string,
    actorId: string,
    name: string
) {
    const access = await audioAccess(client, guildId, actorId, true);
    if (!access.config.queuesEnabled || !access.config.clipsEnabled)
        throw new Error('Queues and clips required');
    const current = radioRuntime.status(guildId);
    if (current && current.channelId !== access.channelId)
        throw new Error('Join current audio channel');
    return locked(guildId, async (tx, row) => {
        const board = await tx.audioSoundboard.findUniqueOrThrow({
            where: {
                guildId_name: { guildId, name: playlistName.parse(name) },
            },
        });
        const ids = z
            .array(z.string().uuid())
            .min(1)
            .max(20)
            .parse(board.clipIds);
        if (
            (await tx.audioClip.count({
                where: { guildId, id: { in: ids } },
            })) !== ids.length
        )
            throw new Error('Soundboard has withdrawn or expired clips');
        const items = queueItems.parse(row.items);
        if (items.length + ids.length > 50)
            throw new Error('Queue capacity reached');
        const config = await tx.guildModuleConfig.findUniqueOrThrow({
            where: { guildId_moduleId: { guildId, moduleId: 'audio' } },
        });
        if (
            !config.enabled ||
            !(config.config as Record<string, unknown>).queuesEnabled ||
            !(config.config as Record<string, unknown>).clipsEnabled
        )
            throw new Error('Queues and clips required');
        for (const clipId of ids)
            items.push({
                id: randomUUID(),
                clipId,
                minutes: 1,
                requesterId: actorId,
                channelId: access.channelId,
            });
        return tx.audioQueue.update({ where: { guildId }, data: { items } });
    });
}
