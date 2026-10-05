import { Router } from 'express';

import { communityReport, reportRange } from '../community/reports';
import { requireAuthOrApiKey, requireGuildAccess } from '../middleware';

const router = Router();
router.use(
    '/guilds/:guildId/community-report',
    requireAuthOrApiKey,
    requireGuildAccess
);
router.get('/guilds/:guildId/community-report', async (req, res) => {
    const range = reportRange.safeParse(req.query);
    if (!range.success) {
        res.status(400).json({
            error: 'Choose a past range of at most 90 days',
        });
        return;
    }
    try {
        res.json(await communityReport(req.params.guildId, range.data));
    } catch {
        res.status(503).json({ error: 'Community report unavailable' });
    }
});
export default router;
