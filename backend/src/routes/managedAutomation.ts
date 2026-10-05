import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { scheduledInput } from '../community/scheduledUtilities';
import { resolveLocalTime } from '../community/utilityTime';
import { db } from '../db';
import { providerSource } from '../integrations/config';
import { requireAuthOrApiKey, requireGuildAccess } from '../middleware';

const router = Router();
router.use(
    '/guilds/:guildId/automation',
    requireAuthOrApiKey,
    requireGuildAccess
);
const id = z.string().uuid();
async function enabled(guildId: string, moduleId: string) {
    const row = await db.guildModuleConfig.findUnique({
        where: { guildId_moduleId: { guildId, moduleId } },
    });
    if (!row?.enabled || row.version !== 1) throw new Error('Module disabled');
}
async function locked<T>(
    guildId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>
) {
    return db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
        );
        return work(tx);
    });
}
function nextLocalOccurrence(
    localTime: string,
    timeZone: string,
    cadence: 'daily' | 'weekly',
    ambiguity: 'earlier' | 'later'
) {
    let local = localTime;
    for (let count = 0; count < 370; count++) {
        const at = resolveLocalTime({
            local,
            timeZone,
            disambiguation: ambiguity,
        });
        if (at.getTime() > Date.now() + 10000) return { local, at };
        const date = new Date(`${local}:00Z`);
        date.setUTCDate(date.getUTCDate() + (cadence === 'weekly' ? 7 : 1));
        local = date.toISOString().slice(0, 16);
    }
    throw new Error('No future occurrence');
}
async function cancelAnnouncementEvents(
    tx: Prisma.TransactionClient,
    guildId: string,
    seriesId: string,
    reason: string
) {
    const events = await tx.scheduledUtility.findMany({
        where: { guildId, seriesId, state: 'PENDING' },
        select: { id: true },
    });
    await tx.scheduledUtility.updateMany({
        where: { guildId, seriesId, state: 'PENDING' },
        data: { state: 'CANCELLED', content: '' },
    });
    await tx.durableJob.updateMany({
        where: {
            guildId,
            state: 'PENDING',
            idempotencyKey: {
                in: events.map((event) => `scheduled-utility:${event.id}`),
            },
        },
        data: { state: 'CANCELLED', lastError: reason },
    });
}

router.get('/guilds/:guildId/automation/feeds', async (req, res) => {
    try {
        const [feeds, events] = await Promise.all([
            db.providerFeed.findMany({
                where: { guildId: req.params.guildId },
                orderBy: { createdAt: 'desc' },
                take: 20,
            }),
            db.providerEvent.findMany({
                where: { guildId: req.params.guildId },
                orderBy: { createdAt: 'desc' },
                take: 100,
                select: { id: true, state: true },
            }),
        ]);
        const jobs = await db.durableJob.findMany({
            where: {
                guildId: req.params.guildId,
                idempotencyKey: {
                    in: events.map((event) => `provider-event:${event.id}`),
                },
            },
            select: { idempotencyKey: true, state: true, lastError: true },
        });
        res.json({
            feeds,
            events: events.map((event) => ({
                ...event,
                delivery:
                    jobs.find(
                        (job) =>
                            job.idempotencyKey === `provider-event:${event.id}`
                    ) ?? null,
            })),
        });
    } catch {
        res.status(503).json({ error: 'Provider feeds unavailable' });
    }
});
router.post('/guilds/:guildId/automation/feeds', async (req, res) => {
    const input = z
        .object({
            channelId: z.string().regex(/^\d{17,20}$/),
            provider: z.enum(['twitch', 'youtube', 'rss']),
            source: z.string(),
        })
        .strict()
        .safeParse(req.body);
    if (!input.success) {
        res.status(400).json({ error: 'Invalid provider feed' });
        return;
    }
    try {
        await enabled(req.params.guildId, 'integrations');
        const feed = await locked(req.params.guildId, async (tx) => {
            const subscription = providerSource.parse({
                provider: input.data.provider,
                source: input.data.source,
            });
            const prior = await tx.providerFeed.findUnique({
                where: {
                    guildId_provider_source: {
                        guildId: req.params.guildId,
                        ...subscription,
                    },
                },
            });
            if (prior)
                return tx.providerFeed.update({
                    where: { id: prior.id },
                    data: {
                        channelId: input.data.channelId,
                        actorId: req.user!.discordId,
                        enabled: true,
                        nextPollAt: new Date(),
                        failures: 0,
                        lastError: null,
                    },
                });
            if (
                (await tx.providerFeed.count({
                    where: { guildId: req.params.guildId },
                })) >= 20
            )
                throw new Error('Feed capacity');
            return tx.providerFeed.create({
                data: {
                    guildId: req.params.guildId,
                    actorId: req.user!.discordId,
                    channelId: input.data.channelId,
                    ...subscription,
                },
            });
        });
        res.status(201).json(feed);
    } catch {
        res.status(409).json({
            error: 'Feed was not saved. Enable integrations and check capacity.',
        });
    }
});
router.patch('/guilds/:guildId/automation/feeds/:id', async (req, res) => {
    const input = z
        .object({ enabled: z.boolean() })
        .strict()
        .safeParse(req.body);
    if (!input.success || !id.safeParse(req.params.id).success) {
        res.status(400).json({ error: 'Invalid feed update' });
        return;
    }
    try {
        if (input.data.enabled)
            await enabled(req.params.guildId, 'integrations');
        await locked(req.params.guildId, async (tx) => {
            const changed = await tx.providerFeed.updateMany({
                where: { id: req.params.id, guildId: req.params.guildId },
                data: {
                    enabled: input.data.enabled,
                    nextPollAt: input.data.enabled ? new Date() : undefined,
                    failures: input.data.enabled ? 0 : undefined,
                    lastError: input.data.enabled ? null : undefined,
                },
            });
            if (!changed.count) throw new Error('unavailable');
            if (!input.data.enabled) {
                const events = await tx.providerEvent.findMany({
                    where: {
                        feedId: req.params.id,
                        guildId: req.params.guildId,
                        state: 'PENDING',
                    },
                    select: { id: true },
                });
                await tx.providerEvent.updateMany({
                    where: {
                        feedId: req.params.id,
                        guildId: req.params.guildId,
                        state: 'PENDING',
                    },
                    data: { state: 'CANCELLED' },
                });
                await tx.durableJob.updateMany({
                    where: {
                        guildId: req.params.guildId,
                        state: 'PENDING',
                        idempotencyKey: {
                            in: events.map(
                                (event) => `provider-event:${event.id}`
                            ),
                        },
                    },
                    data: { state: 'CANCELLED', lastError: 'Feed paused' },
                });
            }
        });
        res.json({ enabled: input.data.enabled });
    } catch {
        res.status(404).json({ error: 'Feed unavailable' });
    }
});
router.post(
    '/guilds/:guildId/automation/feeds/:id/refresh',
    async (req, res) => {
        if (!id.safeParse(req.params.id).success) {
            res.status(400).json({ error: 'Invalid feed' });
            return;
        }
        try {
            await enabled(req.params.guildId, 'integrations');
            const updated = await locked(req.params.guildId, (tx) =>
                tx.providerFeed.updateMany({
                    where: {
                        id: req.params.id,
                        guildId: req.params.guildId,
                        enabled: true,
                    },
                    data: { nextPollAt: new Date() },
                })
            );
            if (!updated.count) throw new Error('Unavailable');
            res.status(202).json({ state: 'POLL_REQUESTED' });
        } catch {
            res.status(409).json({ error: 'Enabled feed unavailable' });
        }
    }
);
router.delete('/guilds/:guildId/automation/feeds/:id', async (req, res) => {
    if (!id.safeParse(req.params.id).success) {
        res.status(400).json({ error: 'Invalid feed' });
        return;
    }
    try {
        await locked(req.params.guildId, async (tx) => {
            const pending = await tx.providerEvent.findMany({
                where: {
                    feedId: req.params.id,
                    guildId: req.params.guildId,
                    state: 'PENDING',
                },
                select: { id: true },
            });
            const removed = await tx.providerFeed.deleteMany({
                where: { id: req.params.id, guildId: req.params.guildId },
            });
            if (!removed.count) throw new Error('unavailable');
            await tx.providerEvent.updateMany({
                where: { id: { in: pending.map((row) => row.id) } },
                data: { state: 'CANCELLED' },
            });
            await tx.durableJob.updateMany({
                where: {
                    guildId: req.params.guildId,
                    state: 'PENDING',
                    idempotencyKey: {
                        in: pending.map((row) => `provider-event:${row.id}`),
                    },
                },
                data: { state: 'CANCELLED', lastError: 'Feed removed' },
            });
        });
        res.status(204).end();
    } catch {
        res.status(404).json({ error: 'Feed unavailable' });
    }
});

const announcement = scheduledInput
    .extend({
        kind: z.literal('ANNOUNCEMENT').default('ANNOUNCEMENT'),
        cadence: z.enum(['daily', 'weekly']),
        days: z.number().int().min(1).max(365),
        disambiguation: z.enum(['earlier', 'later']),
        requestId: z.string().uuid(),
    })
    .strict();
router.get('/guilds/:guildId/automation/announcements', async (req, res) => {
    try {
        res.json(
            await db.announcementSeries.findMany({
                where: { guildId: req.params.guildId },
                orderBy: { createdAt: 'desc' },
                take: 100,
            })
        );
    } catch {
        res.status(503).json({ error: 'Announcements unavailable' });
    }
});
router.post('/guilds/:guildId/automation/announcements', async (req, res) => {
    const input = announcement.safeParse(req.body);
    if (!input.success) {
        res.status(400).json({ error: 'Invalid recurring announcement' });
        return;
    }
    try {
        await enabled(req.params.guildId, 'scheduled-utilities');
        const at = resolveLocalTime({
            local: input.data.local,
            timeZone: input.data.timeZone,
            disambiguation: input.data.disambiguation,
        });
        if (
            at.getTime() < Date.now() + 10000 ||
            at.getTime() > Date.now() + 30 * 86400000
        )
            throw new Error('time');
        const series = await locked(req.params.guildId, async (tx) => {
            const existing = await tx.announcementSeries.findUnique({
                where: {
                    guildId_requestId: {
                        guildId: req.params.guildId,
                        requestId: input.data.requestId,
                    },
                },
            });
            if (existing) {
                if (existing.actorId !== req.user!.discordId)
                    throw new Error('request owner');
                return existing;
            }
            if (
                (await tx.announcementSeries.count({
                    where: { guildId: req.params.guildId },
                })) >= 100
            )
                throw new Error('capacity');
            const row = await tx.announcementSeries.create({
                data: {
                    guildId: req.params.guildId,
                    actorId: req.user!.discordId,
                    requestId: input.data.requestId,
                    channelId: input.data.channelId,
                    content: input.data.content,
                    timeZone: input.data.timeZone,
                    localTime: input.data.local,
                    cadence: input.data.cadence,
                    ambiguity: input.data.disambiguation,
                    nextAt: at,
                    endsAt: new Date(at.getTime() + input.data.days * 86400000),
                },
            });
            const event = await tx.scheduledUtility.create({
                data: {
                    guildId: req.params.guildId,
                    actorId: req.user!.discordId,
                    requestId: `series:${row.id}:${at.toISOString()}`,
                    kind: 'ANNOUNCEMENT',
                    channelId: input.data.channelId,
                    content: input.data.content,
                    localTime: input.data.local,
                    timeZone: input.data.timeZone,
                    runAt: at,
                    expiresAt: new Date(at.getTime() + 86400000),
                    seriesId: row.id,
                },
            });
            await tx.durableJob.create({
                data: {
                    guildId: req.params.guildId,
                    actorId: req.user!.discordId,
                    moduleId: 'scheduled-utilities',
                    kind: 'scheduled-utility',
                    idempotencyKey: `scheduled-utility:${event.id}`,
                    payload: { eventId: event.id },
                    runAt: at,
                    expiresAt: event.expiresAt,
                },
            });
            return tx.announcementSeries.update({
                where: { id: row.id },
                data: { lastEventId: event.id },
            });
        });
        res.status(201).json(series);
    } catch {
        res.status(409).json({
            error: 'Announcement was not saved. Enable scheduled utilities and choose a future time.',
        });
    }
});
router.patch(
    '/guilds/:guildId/automation/announcements/:id',
    async (req, res) => {
        const input = z
            .object({ action: z.enum(['pause', 'resume']) })
            .strict()
            .safeParse(req.body);
        if (!input.success || !id.safeParse(req.params.id).success) {
            res.status(400).json({ error: 'Invalid announcement update' });
            return;
        }
        try {
            if (input.data.action === 'resume')
                await enabled(req.params.guildId, 'scheduled-utilities');
            await locked(req.params.guildId, async (tx) => {
                const series = await tx.announcementSeries.findFirstOrThrow({
                    where: { id: req.params.id, guildId: req.params.guildId },
                });
                if (input.data.action === 'pause') {
                    if (series.state === 'CANCELLED')
                        throw new Error('unavailable');
                    await tx.announcementSeries.update({
                        where: { id: series.id },
                        data: { state: 'PAUSED' },
                    });
                    await cancelAnnouncementEvents(
                        tx,
                        req.params.guildId,
                        series.id,
                        'Announcement paused'
                    );
                    return;
                }
                if (series.state !== 'PAUSED' || series.endsAt <= new Date())
                    throw new Error('unavailable');
                const next = nextLocalOccurrence(
                    series.localTime,
                    series.timeZone,
                    series.cadence as 'daily' | 'weekly',
                    series.ambiguity as 'earlier' | 'later'
                );
                if (next.at > series.endsAt) throw new Error('unavailable');
                const event = await tx.scheduledUtility.create({
                    data: {
                        guildId: series.guildId,
                        actorId: series.actorId,
                        requestId: `series:${series.id}:${next.at.toISOString()}`,
                        kind: 'ANNOUNCEMENT',
                        channelId: series.channelId,
                        content: series.content,
                        localTime: next.local,
                        timeZone: series.timeZone,
                        runAt: next.at,
                        expiresAt: new Date(next.at.getTime() + 86400000),
                        seriesId: series.id,
                    },
                });
                await tx.durableJob.create({
                    data: {
                        guildId: series.guildId,
                        actorId: series.actorId,
                        moduleId: 'scheduled-utilities',
                        kind: 'scheduled-utility',
                        idempotencyKey: `scheduled-utility:${event.id}`,
                        payload: { eventId: event.id },
                        runAt: next.at,
                        expiresAt: event.expiresAt,
                    },
                });
                await tx.announcementSeries.update({
                    where: { id: series.id },
                    data: {
                        state: 'ACTIVE',
                        nextAt: next.at,
                        lastEventId: event.id,
                    },
                });
            });
            res.json({
                state: input.data.action === 'pause' ? 'PAUSED' : 'ACTIVE',
            });
        } catch {
            res.status(404).json({ error: 'Announcement unavailable' });
        }
    }
);
router.delete(
    '/guilds/:guildId/automation/announcements/:id',
    async (req, res) => {
        if (!id.safeParse(req.params.id).success) {
            res.status(400).json({ error: 'Invalid announcement' });
            return;
        }
        try {
            await locked(req.params.guildId, async (tx) => {
                const series = await tx.announcementSeries.findFirstOrThrow({
                    where: { id: req.params.id, guildId: req.params.guildId },
                });
                await tx.announcementSeries.update({
                    where: { id: series.id },
                    data: { state: 'CANCELLED', content: '' },
                });
                await cancelAnnouncementEvents(
                    tx,
                    req.params.guildId,
                    series.id,
                    'Announcement removed'
                );
            });
            res.status(204).end();
        } catch {
            res.status(404).json({ error: 'Announcement unavailable' });
        }
    }
);

export default router;
