import os from 'os';

import express from 'express';
import request from 'supertest';

import { requireAuth } from '../../../src/middleware/auth';
import { loadSheddingMiddleware } from '../../../src/middleware/loadShedding';
import { generateAccessToken } from '../../../src/utils/auth';

jest.mock('os', () => ({
    ...jest.requireActual('os'),
    loadavg: jest.fn(() => [4, 4, 4]),
    cpus: jest.fn(() => new Array(4).fill({})),
    freemem: jest.fn(() => 4 * 1024 ** 3),
    totalmem: jest.fn(() => 8 * 1024 ** 3),
}));
jest.mock('../../../src/utils/env', () => ({
    env: {
        ENABLE_LOAD_SHEDDING: true,
        JWT_SECRET: process.env.JWT_SECRET,
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
    },
}));

describe('dashboard control requests during host pressure', () => {
    const app = express();
    app.use(loadSheddingMiddleware);
    app.get('/api/auth/me', requireAuth, (_req, res) => res.sendStatus(200));
    app.get('/api/guilds', requireAuth, (_req, res) => res.sendStatus(200));
    app.put(
        '/api/guilds/:guildId/modules/:moduleId',
        requireAuth,
        (_req, res) => res.sendStatus(204)
    );
    app.use((_req, res) => res.sendStatus(200));
    const token = generateAccessToken({
        userId: 'internal',
        discordId: 'member',
        role: 'USER',
        access: true,
    });

    it.each(['cpu', 'memory'])(
        'allows session recovery and settings with current authentication under %s pressure',
        async (pressure) => {
            jest.mocked(os.loadavg).mockReturnValue(
                pressure === 'cpu' ? [4, 4, 4] : [0.2, 0.2, 0.2]
            );
            jest.mocked(os.freemem).mockReturnValue(
                pressure === 'memory' ? 0 : 4 * 1024 ** 3
            );
            for (const path of ['/api/auth/me', '/api/guilds']) {
                await request(app).get(path).expect(401);
                await request(app)
                    .get(path)
                    .set('Authorization', `Bearer ${token}`)
                    .expect(200);
            }
            const modulePath = '/api/guilds/one/modules/audio';
            await request(app).put(modulePath).expect(401);
            await request(app)
                .put(modulePath)
                .set('Authorization', `Bearer ${token}`)
                .expect(204);
            await request(app).get('/api/guilds/one/modules').expect(200);
            await request(app).post('/api/auth/refresh').expect(200);
            await request(app).get('/api/status').expect(200);
            await request(app).get('/api/status/incidents').expect(200);
        }
    );

    it.each([
        ['get', '/api/auth/me/extra'],
        ['get', '/api/status/private'],
        ['post', '/api/guilds/one/modules/audio/actions'],
        ['post', '/api/guilds/one/modules/audio/clips'],
        ['delete', '/api/guilds/one/modules/audio'],
        ['get', '/api/suspicion'],
    ] as const)('retains shedding for %s %s', async (method, path) => {
        jest.mocked(os.loadavg).mockReturnValue([4, 4, 4]);
        const response =
            method === 'get'
                ? request(app).get(path)
                : method === 'post'
                  ? request(app).post(path)
                  : request(app).delete(path);
        await response.expect(503);
    });
});
