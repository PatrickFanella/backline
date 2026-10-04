import { RequestHandler } from 'express';

import { authorizeGuild } from '../guilds/authorization';
import { env } from '../utils/env';

export const validateGuild: RequestHandler = async (req, res, next) => {
    if (
        req.query.guildId !== undefined &&
        typeof req.query.guildId !== 'string'
    ) {
        res.status(400).json({ error: 'A valid guild ID is required' });
        return;
    }
    const guildId =
        typeof req.query.guildId === 'string'
            ? req.query.guildId
            : env.DISCORD_GUILD_ID;
    if (!guildId || !/^\d+$/.test(guildId)) {
        res.status(400).json({ error: 'A valid guild ID is required' });
        return;
    }
    if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    try {
        if (!(await authorizeGuild(req.user.userId, guildId))) {
            res.status(403).json({
                error: 'Server management access required',
            });
            return;
        }
        req.guildId = guildId;
        next();
    } catch {
        res.status(503).json({ error: 'Server authorization unavailable' });
    }
};
