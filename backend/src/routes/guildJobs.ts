import { Router } from 'express';
import { z } from 'zod';

import { db } from '../db';
import { enqueueJob } from '../jobs/store';
import { requireAuthOrApiKey, requireGuildAccess } from '../middleware';
import { apiLimiter } from '../middleware/rateLimiter';

const router = Router();
router.use(
    '/guilds/:guildId/jobs',
    apiLimiter,
    requireAuthOrApiKey,
    requireGuildAccess
);
const statusRequest = z.object({
    idempotencyKey: z.string().min(1).max(200),
    runAt: z.iso.datetime().optional(),
});
router.post('/guilds/:guildId/jobs/status', async (req, res) => {
    const body = statusRequest.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: 'Invalid action request' });
        return;
    }
    const runAt = body.data.runAt ? new Date(body.data.runAt) : new Date();
    if (runAt.getTime() > Date.now() + 30 * 86400000) {
        res.status(400).json({ error: 'Schedule is limited to 30 days' });
        return;
    }
    try {
        const job = await enqueueJob({
            guildId: req.params.guildId,
            actorId: req.user!.userId,
            kind: 'server-status',
            idempotencyKey: body.data.idempotencyKey,
            payload: {},
            runAt,
            expiresAt: new Date(runAt.getTime() + 86400000),
        });
        res.status(202).json({ id: job.id, state: job.state });
    } catch {
        res.status(503).json({ error: 'Action queue unavailable' });
    }
});
router.get('/guilds/:guildId/jobs/:jobId', async (req, res) => {
    try {
        const job = await db.durableJob.findFirst({
            where: { id: req.params.jobId, guildId: req.params.guildId },
            include: { history: { orderBy: { number: 'asc' } } },
        });
        if (!job) {
            res.status(404).json({ error: 'Action not found' });
            return;
        }
        res.json(job);
    } catch {
        res.status(503).json({ error: 'Action history unavailable' });
    }
});
export default router;
