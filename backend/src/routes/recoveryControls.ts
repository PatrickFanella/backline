import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';

import { db } from '../db';
import { enqueueJob } from '../jobs/store';
import { requireAuthOrApiKey, requireGuildAccess } from '../middleware';

const router = Router();
router.use(
    '/guilds/:guildId/modules/recovery',
    requireAuthOrApiKey,
    requireGuildAccess
);

const resourceId = z.string().regex(/^\d{17,20}$/);
const jsonPayload = z.json();
type JsonPayload = z.infer<typeof jsonPayload>;
const previewInput = z
    .object({
        snapshotId: z.string().uuid(),
        selected: z.array(resourceId).max(20),
    })
    .strict();
const mappingInput = z
    .object({
        kind: z.enum(['role', 'channel']),
        sourceId: resourceId,
        targetId: resourceId,
    })
    .strict();
const applyInput = z
    .object({
        confirmation: z.string().max(200),
        requestId: z.string().uuid().optional(),
    })
    .strict();
async function recoveryEnabled(guildId: string) {
    const row = await db.guildModuleConfig.findUnique({
        where: { guildId_moduleId: { guildId, moduleId: 'recovery' } },
    });
    if (!row?.enabled || row.version !== 1)
        throw new Error('Recovery disabled');
}
async function enqueue(
    guildId: string,
    actorId: string,
    kind: string,
    requestId: string,
    payload: JsonPayload
) {
    await recoveryEnabled(guildId);
    return enqueueJob({
        guildId,
        actorId,
        moduleId: 'recovery',
        kind,
        idempotencyKey: `${kind}:${requestId}`,
        payload: jsonPayload.parse(payload),
        runAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60000),
        maxAttempts: 1,
    });
}
router.post('/guilds/:guildId/modules/recovery/previews', async (req, res) => {
    const input = previewInput.safeParse(req.body);
    if (
        !input.success ||
        new Set(input.data.selected).size !== input.data.selected.length
    ) {
        res.status(400).json({ error: 'Invalid restore preview selection' });
        return;
    }
    try {
        const requestId = randomUUID();
        const job = await enqueue(
            req.params.guildId,
            req.user!.userId,
            'restore-preview',
            requestId,
            { ...input.data, requestId, discordId: req.user!.discordId }
        );
        res.status(202).json({ jobId: job.id, requestId });
    } catch {
        res.status(409).json({ error: 'Restore preview could not be queued' });
    }
});
router.post('/guilds/:guildId/modules/recovery/mappings', async (req, res) => {
    const input = mappingInput.safeParse(req.body);
    if (!input.success) {
        res.status(400).json({ error: 'Invalid restore mapping' });
        return;
    }
    try {
        const requestId = randomUUID();
        const job = await enqueue(
            req.params.guildId,
            req.user!.userId,
            'restore-map',
            requestId,
            { ...input.data, discordId: req.user!.discordId }
        );
        res.status(202).json({ jobId: job.id });
    } catch {
        res.status(409).json({ error: 'Restore mapping could not be queued' });
    }
});
router.post(
    '/guilds/:guildId/modules/recovery/plans/:id/apply',
    async (req, res) => {
        const input = applyInput.safeParse(req.body);
        if (
            !input.success ||
            !z.string().uuid().safeParse(req.params.id).success
        ) {
            res.status(400).json({ error: 'Invalid restore apply request' });
            return;
        }
        try {
            const requestId = input.data.requestId ?? randomUUID();
            const job = await enqueue(
                req.params.guildId,
                req.user!.userId,
                'restore-apply-request',
                requestId,
                {
                    planId: req.params.id,
                    confirmation: input.data.confirmation,
                    discordId: req.user!.discordId,
                }
            );
            res.status(202).json({ jobId: job.id, requestId });
        } catch {
            res.status(409).json({
                error: 'Restore apply could not be queued',
            });
        }
    }
);

export default router;
