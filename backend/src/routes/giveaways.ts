import { Router } from 'express';
import { z } from 'zod';

import { giveawayInput } from '../community/giveaways';
import { db } from '../db';
import { enqueueJob } from '../jobs/store';
import { requireAuthOrApiKey, requireGuildAccess } from '../middleware';
import { moduleRegistry } from '../modules/registry';

const router = Router();
router.use(
    '/guilds/:guildId/giveaways',
    requireAuthOrApiKey,
    requireGuildAccess
);
router.get('/guilds/:guildId/giveaways', async (req, res) => {
    try {
        res.json(
            await db.giveaway.findMany({
                where: { guildId: req.params.guildId },
                orderBy: { createdAt: 'desc' },
                take: 100,
                include: {
                    draws: { orderBy: { round: 'asc' } },
                    _count: { select: { entries: true } },
                },
            })
        );
    } catch {
        res.status(503).json({ error: 'Giveaway history unavailable' });
    }
});
const createInput = giveawayInput.extend({ requestId: z.string().uuid() });
router.post('/guilds/:guildId/giveaways', async (req, res) => {
    const parsed = createInput.safeParse(req.body);
    if (
        !parsed.success ||
        parsed.data.endsAt.getTime() < Date.now() + 5000 ||
        parsed.data.endsAt.getTime() > Date.now() + 30 * 86400000
    ) {
        res.status(400).json({
            error: 'Choose a channel, prize and deadline within the next 30 days',
        });
        return;
    }
    try {
        if (!(await moduleRegistry.enabled(req.params.guildId, 'giveaways'))) {
            res.status(409).json({ error: 'Enable giveaways first' });
            return;
        }
        const { requestId, ...data } = parsed.data;
        const job = await enqueueJob({
            guildId: req.params.guildId,
            actorId: req.user!.discordId,
            moduleId: 'giveaways',
            kind: 'giveaway-create',
            idempotencyKey: `giveaway-create:${requestId}`,
            payload: { ...data, endsAt: data.endsAt.toISOString() },
            runAt: new Date(),
            expiresAt: data.endsAt,
        });
        res.status(202).json({ id: job.id, state: job.state });
    } catch {
        res.status(503).json({ error: 'Giveaway queue unavailable' });
    }
});
router.post(
    [
        '/guilds/:guildId/giveaways/:giveawayId/reroll',
        '/guilds/:guildId/giveaways/:giveawayId/draw',
    ],
    async (req, res) => {
        const reroll = req.path.endsWith('/reroll');
        const body = z
            .object({ requestId: z.string().uuid() })
            .strict()
            .safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: 'Invalid draw request' });
            return;
        }
        try {
            const giveaway = await db.giveaway.findFirst({
                where: {
                    id: req.params.giveawayId,
                    guildId: req.params.guildId,
                },
                include: { draws: { orderBy: { round: 'desc' }, take: 1 } },
            });
            if (
                !giveaway ||
                (reroll
                    ? giveaway.state !== 'DRAWN'
                    : giveaway.state !== 'OPEN' ||
                      giveaway.endsAt > new Date()) ||
                giveaway.expiresAt <= new Date() ||
                (reroll && giveaway.draws[0]?.announcement !== 'DELIVERED') ||
                !(await moduleRegistry.enabled(req.params.guildId, 'giveaways'))
            ) {
                res.status(409).json({
                    error: 'Giveaway not ready for this draw',
                });
                return;
            }
            const job = await enqueueJob({
                guildId: req.params.guildId,
                actorId: req.user!.discordId,
                moduleId: 'giveaways',
                kind: reroll ? 'giveaway-reroll' : 'giveaway-draw',
                idempotencyKey: `giveaway-${reroll ? 'reroll' : 'draw-manual'}:${giveaway.id}:${body.data.requestId}`,
                payload: { giveawayId: giveaway.id },
                runAt: new Date(),
                expiresAt: giveaway.expiresAt,
            });
            res.status(202).json({ id: job.id, state: job.state });
        } catch {
            res.status(503).json({ error: 'Draw queue unavailable' });
        }
    }
);
export default router;
