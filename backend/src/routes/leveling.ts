import { Router } from 'express';

import { leaderboard, profile } from '../community/leveling';
import { requireAuthOrApiKey, requireGuildAccess } from '../middleware';

const router = Router();
router.use(
    '/guilds/:guildId/leveling',
    requireAuthOrApiKey,
    requireGuildAccess
);
router.get('/guilds/:guildId/leveling', async (req, res) => {
    try {
        res.json({
            leaderboard: await leaderboard(req.params.guildId),
            profile: await profile(req.params.guildId, req.user!.discordId),
        });
    } catch {
        res.status(503).json({ error: 'Server XP unavailable' });
    }
});
export default router;
