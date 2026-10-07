import express from 'express';
import request from 'supertest';

import { slowDownMiddleware } from '../../../src/middleware/ddosProtection';
import { isHealthProbe } from '../../../src/middleware/healthProbe';

describe('health probes and request slowdown', () => {
    it('keeps probes and subsequent application traffic fast after repeated polling', async () => {
        const app = express();
        app.use(slowDownMiddleware);
        app.use((_req, res) => {
            res.sendStatus(200);
        });
        for (let index = 0; index < 52; index++) {
            await request(app).get('/health/live').timeout(1000).expect(200);
        }
        await request(app).head('/health/ready').timeout(1000).expect(200);
        await request(app).get('/api/guilds').timeout(1000).expect(200);
    }, 10000);

    it.each([
        ['POST', '/health/live'],
        ['GET', '/health/live/extra'],
        ['GET', '/api/guilds'],
        ['GET', '/health/unknown'],
    ])('does not exempt %s %s', (method, path) => {
        expect(isHealthProbe({ method, path } as express.Request)).toBe(false);
    });
});
