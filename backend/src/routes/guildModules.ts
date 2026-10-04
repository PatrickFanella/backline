import { Router } from 'express';
import { z } from 'zod';

import { db } from '../db';
import { requireAuthOrApiKey, requireGuildAccess } from '../middleware';
import { moduleRegistry } from '../modules/registry';

const router = Router();
const updateSchema = z.object({
    enabled: z.boolean(),
    config: z.unknown().default({}),
});
router.use('/guilds/:guildId/modules', requireAuthOrApiKey, requireGuildAccess);
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
