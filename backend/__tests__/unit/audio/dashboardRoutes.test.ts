import express from 'express';
import request from 'supertest';

import { db } from '../../../src/db';
import { enqueueJob } from '../../../src/jobs/store';
import guildModules from '../../../src/routes/guildModules';

jest.mock('../../../src/middleware', () => ({
    requireAuthOrApiKey: (
        req: express.Request,
        _res: express.Response,
        next: express.NextFunction
    ) => {
        req.user = {
            userId: 'internal-user',
            discordId: '123456789012345678',
            role: 'USER',
        } as express.Request['user'];
        next();
    },
    requireGuildAccess: (
        _req: express.Request,
        _res: express.Response,
        next: express.NextFunction
    ) => next(),
}));
jest.mock('../../../src/jobs/store', () => ({ enqueueJob: jest.fn() }));
jest.mock('../../../src/db', () => ({
    db: {
        audioQueue: { findUnique: jest.fn() },
        audioPlaylist: { findMany: jest.fn() },
        voicePlayback: { findMany: jest.fn() },
        durableJob: { findMany: jest.fn() },
    },
}));

describe('managed audio dashboard routes', () => {
    const app = express();
    app.use(express.json());
    app.use(guildModules);

    beforeEach(() => jest.clearAllMocks());

    it('records a scoped, short-lived durable audio action for the Gateway worker', async () => {
        (enqueueJob as jest.Mock).mockResolvedValue({
            id: 'job-1',
            state: 'PENDING',
        });
        const requestId = '8d2f6d15-2e28-4e31-a4b4-4a65c937ae18';

        const response = await request(app)
            .post('/guilds/123456789012345678/modules/audio/actions')
            .send({
                action: 'enqueue',
                station: 'defcon',
                minutes: 10,
                requestId,
            });

        expect(response.status).toBe(202);
        expect(response.body).toEqual({ id: 'job-1', state: 'PENDING' });
        expect(enqueueJob).toHaveBeenCalledWith(
            expect.objectContaining({
                guildId: '123456789012345678',
                actorId: 'internal-user',
                moduleId: 'audio',
                kind: 'audio-dashboard',
                idempotencyKey: `audio-dashboard:internal-user:${requestId}`,
                payload: {
                    action: 'enqueue',
                    station: 'defcon',
                    minutes: 10,
                    requestId,
                    discordId: '123456789012345678',
                },
                maxAttempts: 1,
            })
        );
        const [job] = (enqueueJob as jest.Mock).mock.calls[0];
        expect(
            job.expiresAt.getTime() - job.runAt.getTime()
        ).toBeLessThanOrEqual(300000);
        expect(job.expiresAt.getTime() - job.runAt.getTime()).toBeGreaterThan(
            299000
        );
    });

    it('returns persisted queue, playback, playlists, and action records without a voice runtime', async () => {
        const item = {
            id: 'de5e3372-4b35-48de-b003-c1cfdbb8a15c',
            station: 'defcon',
            minutes: 10,
            requesterId: '123456789012345678',
            channelId: '123456789012345679',
        };
        (db.audioQueue.findUnique as jest.Mock).mockResolvedValue({
            guildId: '123456789012345678',
            items: [item],
            state: 'IDLE',
            loop: false,
            shuffle: false,
        });
        (db.audioPlaylist.findMany as jest.Mock).mockResolvedValue([
            {
                id: 'playlist-1',
                name: 'Late night',
                createdBy: '123456789012345678',
                createdAt: new Date('2026-10-05T00:00:00.000Z'),
                items: [item],
            },
        ]);
        (db.voicePlayback.findMany as jest.Mock).mockResolvedValue([]);
        (db.durableJob.findMany as jest.Mock).mockResolvedValue([]);

        const response = await request(app).get(
            '/guilds/123456789012345678/modules/audio/diagnostics'
        );

        expect(response.status).toBe(200);
        expect(response.body.queue.items).toEqual([item]);
        expect(response.body.playlists).toHaveLength(1);
        expect(response.body.playlists[0].items).toEqual([item]);
        expect(response.body.stations).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: 'defcon' })])
        );
        expect(db.audioQueue.findUnique).toHaveBeenCalledWith({
            where: { guildId: '123456789012345678' },
        });
        for (const model of [db.audioPlaylist, db.voicePlayback, db.durableJob])
            expect(Object.values(model)[0] as jest.Mock).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        guildId: '123456789012345678',
                    }),
                })
            );
    });

    it('rejects malformed actions before queuing work', async () => {
        const response = await request(app)
            .post('/guilds/123456789012345678/modules/audio/actions')
            .send({ action: 'start', requestId: 'not-a-uuid' });

        expect(response.status).toBe(400);
        expect(enqueueJob).not.toHaveBeenCalled();

        const forgedStation = await request(app)
            .post('/guilds/123456789012345678/modules/audio/actions')
            .send({
                action: 'enqueue',
                station: 'attacker-stream',
                minutes: 10,
                requestId: '8d2f6d15-2e28-4e31-a4b4-4a65c937ae18',
            });
        expect(forgedStation.status).toBe(400);
        expect(enqueueJob).not.toHaveBeenCalled();
    });
});
