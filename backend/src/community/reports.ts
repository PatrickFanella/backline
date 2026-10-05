import { DurableJob, Prisma } from '@prisma/client';
import { ChannelType, Client, PermissionFlagsBits, Status } from 'discord.js';
import { z } from 'zod';

import { db } from '../db';
import { ActionOutcome, JobHandler, enqueueJob } from '../jobs/store';
import { moduleRegistry } from '../modules/registry';

import { communityReportsConfig } from './config';

const minuteOf = (at: Date) =>
    new Date(Math.floor(at.getTime() / 60000) * 60000);
async function settings(guildId: string) {
    if (!(await moduleRegistry.enabled(guildId, 'community-reports')))
        return null;
    const saved = await db.guildModuleConfig.findUnique({
        where: { guildId_moduleId: { guildId, moduleId: 'community-reports' } },
    });
    return saved ? communityReportsConfig.parse(saved.config) : null;
}
const observationInput = z
    .object({
        guildId: z.string(),
        eventId: z.string().min(1).max(100),
        memberId: z.string(),
        channelId: z.string().optional(),
        kind: z.enum(['messages', 'joins', 'departures']),
        at: z.date(),
        joinedAt: z.date().optional(),
        bot: z.boolean().default(false),
    })
    .strict();
export async function recordCommunityEvent(
    input: z.input<typeof observationInput>
): Promise<boolean> {
    const event = observationInput.parse(input);
    if (event.bot || Math.abs(Date.now() - event.at.getTime()) > 300000)
        return false;
    if (!(await settings(event.guildId))) return false;
    return db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${event.guildId})::bigint)::text`
        );
        const saved = await tx.guildModuleConfig.findUnique({
            where: {
                guildId_moduleId: {
                    guildId: event.guildId,
                    moduleId: 'community-reports',
                },
            },
        });
        const installation = await tx.guildInstallation.findUnique({
            where: { guildId: event.guildId },
        });
        if (!saved?.enabled || !installation?.active) return false;
        const config = communityReportsConfig.parse(saved.config);
        if (
            event.channelId &&
            config.excludedChannels.includes(event.channelId)
        )
            return false;
        if (
            (await tx.communityObservation.count({
                where: { guildId: event.guildId },
            })) >= 100000
        )
            throw new Error('Observation capacity reached');
        const { bot: _bot, joinedAt, ...data } = event;
        const created = await tx.communityObservation.createMany({
            data: [
                {
                    ...data,
                    eventId:
                        event.kind === 'departures' && !joinedAt
                            ? `unknown:${event.eventId}`
                            : event.eventId,
                },
            ],
            skipDuplicates: true,
        });
        if (!created.count) return false;
        if (event.kind === 'joins')
            await tx.communityCohort.upsert({
                where: {
                    guildId_memberId_joinedAt: {
                        guildId: event.guildId,
                        memberId: event.memberId,
                        joinedAt: joinedAt ?? event.at,
                    },
                },
                create: {
                    guildId: event.guildId,
                    memberId: event.memberId,
                    joinedAt: joinedAt ?? event.at,
                },
                update: {},
            });
        if (event.kind === 'departures' && joinedAt)
            await tx.communityCohort.updateMany({
                where: {
                    guildId: event.guildId,
                    memberId: event.memberId,
                    joinedAt,
                    leftAt: null,
                },
                data: { leftAt: event.at },
            });
        return true;
    });
}
export async function recordCommunityCoverage(
    guildId: string,
    at = new Date()
): Promise<void> {
    if (!(await settings(guildId))) return;
    if ((await db.communityObservation.count({ where: { guildId } })) >= 100000)
        return;
    await db.communityCoverage.createMany({
        data: [{ guildId, minute: minuteOf(at) }],
        skipDuplicates: true,
    });
}
export const reportRange = z
    .object({ from: z.coerce.date(), to: z.coerce.date() })
    .refine(
        ({ from, to }) =>
            to > from &&
            to.getTime() - from.getTime() <= 90 * 86400000 &&
            to.getTime() <= Date.now() + 60000,
        'Choose a past range of at most 90 days'
    );
export async function communityReport(
    guildId: string,
    input: z.input<typeof reportRange>
) {
    const { from, to } = reportRange.parse(input);
    const configRow = await db.guildModuleConfig.findUnique({
        where: { guildId_moduleId: { guildId, moduleId: 'community-reports' } },
    });
    const retentionDays = communityReportsConfig.parse(
        configRow?.config ?? {}
    ).retentionDays;
    const retainedFrom = new Date(Date.now() - retentionDays * 86400000);
    const start = new Date(Math.max(from.getTime(), retainedFrom.getTime()));
    const range = { gte: start, lt: to };
    const [
        totals,
        days,
        channels,
        active,
        coverage,
        cohortTotal,
        cohortDepartures,
        unknownDepartures,
    ] = await Promise.all([
        db.communityObservation.groupBy({
            by: ['kind'],
            where: { guildId, at: range },
            _count: true,
        }),
        db.$queryRaw<{ day: string; kind: string; count: bigint }[]>(
            Prisma.sql`SELECT to_char("at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, kind, count(*) AS count FROM "CommunityObservation" WHERE "guildId" = ${guildId} AND "at" >= ${start} AND "at" < ${to} GROUP BY day, kind ORDER BY day, kind`
        ),
        db.communityObservation.groupBy({
            by: ['channelId'],
            where: { guildId, at: range, kind: 'messages' },
            _count: true,
            orderBy: { _count: { channelId: 'desc' } },
            take: 100,
        }),
        db.$queryRaw<{ count: bigint }[]>(
            Prisma.sql`SELECT count(DISTINCT "memberId") AS count FROM "CommunityObservation" WHERE "guildId" = ${guildId} AND "at" >= ${start} AND "at" < ${to} AND kind = 'messages'`
        ),
        db.communityCoverage.count({
            where: { guildId, minute: { gte: minuteOf(from), lt: to } },
        }),
        db.communityCohort.count({ where: { guildId, joinedAt: range } }),
        db.communityCohort.count({
            where: { guildId, joinedAt: range, leftAt: { lt: to } },
        }),
        db.communityObservation.count({
            where: {
                guildId,
                kind: 'departures',
                eventId: { startsWith: 'unknown:' },
                at: range,
            },
        }),
    ]);
    const expectedMinutes = Math.ceil(
        (to.getTime() - minuteOf(from).getTime()) / 60000
    );
    const complete = coverage === expectedMinutes && from >= retainedFrom;
    const status =
        !coverage && !totals.length
            ? 'UNAVAILABLE'
            : complete
              ? 'OBSERVED'
              : 'PARTIAL';
    const count = (kind: string) =>
        totals.find((row) => row.kind === kind)?._count ?? 0;
    return {
        guildId,
        from,
        to,
        collectionEnabled: !!configRow?.enabled,
        coverage: {
            status,
            observedMinutes: coverage,
            expectedMinutes,
            retainedFrom,
            note: 'Coverage records connected collector samples. Counts include only observed events; permissions and Gateway delivery can limit observations.',
        },
        totals:
            status === 'UNAVAILABLE'
                ? null
                : {
                      messages: count('messages'),
                      joins: count('joins'),
                      departures: count('departures'),
                      activeMembers: Number(active[0]?.count ?? 0),
                  },
        days: days.map((row) => ({ ...row, count: Number(row.count) })),
        channels: channels.map((row) => ({
            channelId: row.channelId,
            messages: row._count,
        })),
        cohort: {
            observedJoins: cohortTotal,
            observedDepartures: cohortDepartures,
            retentionRate:
                complete && !unknownDepartures && cohortTotal
                    ? (cohortTotal - cohortDepartures) / cohortTotal
                    : null,
        },
    };
}
const counterInput = z
    .object({
        channelId: z.string(),
        metric: z.enum(['messages', 'joins', 'departures']),
        days: z.number().int(),
        intervalMinutes: z.number().int(),
        name: z.string().max(100),
    })
    .strict();
export async function scheduleCommunityCounters(
    at = new Date()
): Promise<void> {
    const rows = await db.guildModuleConfig.findMany({
        where: { moduleId: 'community-reports', enabled: true },
    });
    for (const saved of rows) {
        const config = await settings(saved.guildId);
        if (!config) continue;
        for (const counter of config.counters) {
            const period = counter.intervalMinutes * 60000,
                slot = Math.floor(at.getTime() / period);
            const key = `community-counter:${counter.channelId}:${slot}`;
            if (
                await db.durableJob.findUnique({
                    where: {
                        guildId_idempotencyKey: {
                            guildId: saved.guildId,
                            idempotencyKey: key,
                        },
                    },
                })
            )
                continue;
            const total = await db.communityObservation.count({
                where: {
                    guildId: saved.guildId,
                    kind: counter.metric,
                    at: {
                        gte: new Date(
                            Math.max(
                                at.getTime() - counter.days * 86400000,
                                at.getTime() - config.retentionDays * 86400000
                            )
                        ),
                        lt: at,
                    },
                },
            });
            await enqueueJob({
                guildId: saved.guildId,
                actorId: 'community-reports',
                moduleId: 'community-reports',
                kind: 'community-counter',
                idempotencyKey: key,
                payload: {
                    ...counter,
                    name: `observed-${counter.metric}-${counter.days}d-${total}`,
                },
                runAt: at,
                expiresAt: new Date((slot + 1) * period + 60000),
            });
        }
    }
}
async function counterContext(client: Client, job: DurableJob) {
    const data = counterInput.parse(job.payload),
        config = await settings(job.guildId);
    if (
        !config?.counters.some(
            (counter) =>
                counter.channelId === data.channelId &&
                counter.metric === data.metric &&
                counter.days === data.days &&
                counter.intervalMinutes === data.intervalMinutes
        )
    )
        return null;
    const guild = await client.guilds.fetch({
        guild: job.guildId,
        force: true,
    });
    const channel = await guild.channels.fetch(data.channelId, { force: true });
    if (
        !channel ||
        ![ChannelType.GuildVoice, ChannelType.GuildText].includes(
            channel.type
        ) ||
        !('setName' in channel)
    )
        return null;
    const bot = await guild.members.fetchMe({ force: true });
    if (
        !channel
            .permissionsFor(bot)
            ?.has([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ManageChannels,
            ])
    )
        throw new Error('Counter channel permissions denied');
    return { channel, data };
}
export function communityCounterHandler(client: Client): JobHandler {
    const delivered = (name: string): ActionOutcome => ({
        state: 'DELIVERED',
        result: { name },
    });
    return {
        authorize: async (job) =>
            job.expiresAt > new Date() && !!(await settings(job.guildId)),
        execute: async (job) => {
            const context = await counterContext(client, job);
            if (!context)
                return {
                    state: 'CANCELLED',
                    reason: 'Counter no longer configured',
                };
            const { channel, data } = context;
            if (channel.name === data.name) return delivered(data.name);
            const reserved = await db.$transaction(async (tx) => {
                await tx.$queryRaw(
                    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${job.guildId})::bigint)::text`
                );
                const saved = await tx.guildModuleConfig.findUnique({
                    where: {
                        guildId_moduleId: {
                            guildId: job.guildId,
                            moduleId: 'community-reports',
                        },
                    },
                });
                if (
                    !saved?.enabled ||
                    job.expiresAt <= new Date() ||
                    !communityReportsConfig
                        .parse(saved.config)
                        .counters.some(
                            (counter) =>
                                counter.channelId === data.channelId &&
                                counter.metric === data.metric &&
                                counter.days === data.days &&
                                counter.intervalMinutes === data.intervalMinutes
                        )
                )
                    return false;
                const previous = await tx.communityCounter.findUnique({
                    where: {
                        guildId_channelId: {
                            guildId: job.guildId,
                            channelId: data.channelId,
                        },
                    },
                });
                if (
                    previous &&
                    Date.now() - previous.lastAttemptAt.getTime() <
                        data.intervalMinutes * 60000
                )
                    return false;
                await tx.communityCounter.upsert({
                    where: {
                        guildId_channelId: {
                            guildId: job.guildId,
                            channelId: data.channelId,
                        },
                    },
                    create: {
                        guildId: job.guildId,
                        channelId: data.channelId,
                        lastAttemptAt: new Date(),
                        expectedName: data.name,
                    },
                    update: {
                        lastAttemptAt: new Date(),
                        expectedName: data.name,
                    },
                });
                return true;
            });
            if (!reserved)
                return {
                    state: 'CANCELLED',
                    reason: 'Counter interval already consumed',
                };
            await channel.setName(
                data.name,
                'Configured observed community counter'
            );
            return delivered(data.name);
        },
        reconcile: async (job) => {
            const context = await counterContext(client, job);
            if (!context)
                return {
                    state: 'CANCELLED',
                    reason: 'Counter no longer configured',
                };
            return context.channel.name === context.data.name
                ? delivered(context.data.name)
                : {
                      state: 'RECONCILE',
                      reason: 'Counter outcome not confirmed; next scheduled interval can update it',
                  };
        },
    };
}
export async function maintainCommunityReports(): Promise<void> {
    const rows = await db.guildModuleConfig.findMany({
        where: { moduleId: 'community-reports' },
    });
    for (const saved of rows) {
        const cutoff = new Date(
            Date.now() -
                communityReportsConfig.parse(saved.config).retentionDays *
                    86400000
        );
        await db.communityObservation.deleteMany({
            where: { guildId: saved.guildId, at: { lt: cutoff } },
        });
        await db.communityCoverage.deleteMany({
            where: { guildId: saved.guildId, minute: { lt: cutoff } },
        });
        await db.communityCohort.deleteMany({
            where: { guildId: saved.guildId, joinedAt: { lt: cutoff } },
        });
        await db.durableJob.deleteMany({
            where: {
                guildId: saved.guildId,
                kind: 'community-counter',
                expiresAt: { lt: cutoff },
                state: {
                    in: ['DELIVERED', 'CANCELLED', 'FAILED', 'RECONCILE'],
                },
            },
        });
    }
    await db.durableJob.updateMany({
        where: {
            kind: 'community-counter',
            state: 'RECONCILE',
            expiresAt: { lte: new Date() },
        },
        data: {
            state: 'CANCELLED',
            lastError:
                'Counter interval expired with an unconfirmed rename outcome',
        },
    });
    await scheduleCommunityCounters();
}
export function registerCommunityReportEvents(
    client: Client
): () => Promise<void> {
    const pending = new Set<Promise<unknown>>();
    const gaps = new Map<string, { guildId: string; minute: Date }>();
    const gap = (input: z.input<typeof observationInput>) => {
        const minute = minuteOf(input.at);
        gaps.set(`${input.guildId}:${minute.getTime()}`, {
            guildId: input.guildId,
            minute,
        });
        void db.communityCoverage
            .deleteMany({ where: { guildId: input.guildId, minute } })
            .catch(() =>
                console.warn('Community coverage gap recording failed')
            );
    };
    const record = (input: z.input<typeof observationInput>) => {
        if (input.bot) return;
        if (pending.size >= 500) {
            gap(input);
            return;
        }
        const action = recordCommunityEvent(input)
            .catch(() => {
                gap(input);
                console.warn('Community observation failed');
            })
            .finally(() => pending.delete(action));
        pending.add(action);
    };
    client.on('messageCreate', (message) => {
        if (message.guildId)
            record({
                guildId: message.guildId,
                eventId: `message:${message.id}`,
                memberId: message.author.id,
                channelId: message.channelId,
                kind: 'messages',
                at: message.createdAt,
                bot: message.author.bot || !!message.webhookId,
            });
    });
    client.on('guildMemberAdd', (member) =>
        record({
            guildId: member.guild.id,
            eventId: `join:${member.id}:${member.joinedTimestamp}`,
            memberId: member.id,
            joinedAt: member.joinedAt ?? undefined,
            kind: 'joins',
            at: new Date(),
            bot: member.user.bot,
        })
    );
    client.on('guildMemberRemove', (member) =>
        record({
            guildId: member.guild.id,
            eventId: `leave:${member.id}:${member.joinedTimestamp ?? Math.floor(Date.now() / 60000)}`,
            memberId: member.id,
            joinedAt: member.joinedAt ?? undefined,
            kind: 'departures',
            at: new Date(),
            bot: member.user.bot,
        })
    );
    let active: Promise<void> | undefined;
    const timer = setInterval(() => {
        if (active || !client.isReady()) return;
        active = (async () => {
            for (const [key, row] of gaps) {
                await db.communityCoverage.deleteMany({
                    where: { guildId: row.guildId, minute: row.minute },
                });
                if (Date.now() - row.minute.getTime() > 360000)
                    gaps.delete(key);
            }
            for (const guild of client.guilds.cache.values())
                if (
                    guild.shard.status === Status.Ready &&
                    !gaps.has(`${guild.id}:${minuteOf(new Date()).getTime()}`)
                )
                    await recordCommunityCoverage(guild.id);
        })()
            .catch(() => console.warn('Community coverage failed'))
            .finally(() => {
                active = undefined;
            });
    }, 30000);
    timer.unref();
    return async () => {
        clearInterval(timer);
        await active;
        await Promise.allSettled(pending);
    };
}
