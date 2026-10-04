import { Router } from 'express';
import { z } from 'zod';

import { db } from '../db';
import { enqueueJob } from '../jobs/store';
import { requireAuthOrApiKey, requireGuildAccess } from '../middleware';
import { apiLimiter } from '../middleware/rateLimiter';
import { moderationInput } from '../moderation/service';

const router = Router();
router.use(
    '/guilds/:guildId/moderation',
    apiLimiter,
    requireAuthOrApiKey,
    requireGuildAccess
);
router.get('/guilds/:guildId/moderation/cases', async (req, res) => {
    try {
        res.json(
            await db.moderationCase.findMany({
                where: { guildId: req.params.guildId },
                orderBy: { createdAt: 'desc' },
                take: 100,
            })
        );
    } catch {
        res.status(503).json({ error: 'Case history unavailable' });
    }
});
router.post('/guilds/:guildId/moderation/actions', async (req, res) => {
    const body = z
        .object({
            idempotencyKey: z.string().min(1).max(100),
            action: moderationInput,
        })
        .strict()
        .safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: 'Invalid moderation action' });
        return;
    }
    try {
        const job = await enqueueJob({
            guildId: req.params.guildId,
            actorId: req.user!.userId,
            kind: 'moderation',
            moduleId: 'moderation',
            idempotencyKey: `moderation:${req.user!.userId}:${body.data.idempotencyKey}`,
            payload: body.data.action,
            runAt: new Date(),
            expiresAt: new Date(Date.now() + 300000),
            maxAttempts: 1,
        });
        res.status(202).json({ id: job.id, state: job.state });
    } catch {
        res.status(503).json({ error: 'Moderation queue unavailable' });
    }
});
export default router;
