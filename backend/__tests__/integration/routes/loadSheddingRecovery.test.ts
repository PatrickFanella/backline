import os from 'os';

import express from 'express';
import request from 'supertest';

import {
    circuitBreakerMiddleware,
    loadSheddingMiddleware,
} from '../../../src/middleware/loadShedding';

jest.mock('os', () => ({
    ...jest.requireActual('os'),
    loadavg: jest.fn(() => [4, 4, 4]),
    cpus: jest.fn(() => new Array(4).fill({})),
    freemem: jest.fn(() => 4 * 1024 ** 3),
    totalmem: jest.fn(() => 8 * 1024 ** 3),
}));
jest.mock('../../../src/utils/env', () => ({
    env: { ENABLE_LOAD_SHEDDING: true },
}));

it('recovers immediately after shedding while real application failures still open the circuit', async () => {
    const app = express();
    app.use(circuitBreakerMiddleware);
    app.use(loadSheddingMiddleware);
    app.get('/ok', (_req, res) => res.sendStatus(200));
    app.get('/fault', (_req, res) => res.sendStatus(500));

    for (let i = 0; i < 5; i++) {
        const response = await request(app).get('/ok');
        expect(response.status).toBe(503);
        expect(response.body.message).toBe(
            'Server under high load, please try again later'
        );
    }

    jest.mocked(os.loadavg).mockReturnValue([0.2, 0.2, 0.2]);
    await request(app).get('/ok').expect(200);

    for (let i = 0; i < 5; i++) {
        await request(app).get('/fault').expect(500);
    }
    const blocked = await request(app).get('/ok').expect(503);
    expect(blocked.body.error).toBe('Circuit breaker open');
});
