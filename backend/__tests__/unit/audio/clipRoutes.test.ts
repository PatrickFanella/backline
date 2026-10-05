import express from 'express';
import request from 'supertest';

import { clipSelect, storeClip } from '../../../src/audio/clips';
import { db } from '../../../src/db';
import guildModules from '../../../src/routes/guildModules';
import { pcmWave } from '../../fixtures/pcmWave';

let allowed = true;
jest.mock('../../../src/middleware', () => ({
    requireAuthOrApiKey: (
        req: express.Request,
        _res: express.Response,
        next: express.NextFunction
    ) => {
        req.user = {
            userId: 'internal',
            discordId: 'manager',
            role: 'USER',
        } as express.Request['user'];
        next();
    },
    requireGuildAccess: (
        _req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ) => {
        if (allowed) next();
        else res.status(403).json({ error: 'Denied' });
    },
}));
jest.mock('../../../src/audio/clips', () => ({
    ...jest.requireActual('../../../src/audio/clips'),
    storeClip: jest.fn(),
}));
jest.mock('../../../src/db', () => ({
    db: { audioClip: { findMany: jest.fn() } },
}));
describe('managed clip HTTP upload boundary', () => {
    const app = express();
    app.use(express.json());
    app.use(guildModules);
    beforeEach(() => {
        allowed = true;
        jest.clearAllMocks();
    });
    it('passes raw WAV bytes and explicit metadata after server authorization', async () => {
        (storeClip as jest.Mock).mockResolvedValue({ id: 'clip' });
        const wave = pcmWave();
        const result = await request(app)
            .post('/guilds/one/modules/audio/clips')
            .query({
                title: 'Tone',
                source: 'Own synth',
                license: 'Original',
                rights: 'original',
                confirmed: 'true',
            })
            .set('Content-Type', 'audio/wav')
            .send(wave);
        expect(result.status).toBe(201);
        expect(storeClip).toHaveBeenCalledWith('one', 'manager', wave, {
            title: 'Tone',
            source: 'Own synth',
            license: 'Original',
            rights: 'original',
            confirmed: true,
        });
    });
    it('denies both metadata and bytes before storage when access is revoked', async () => {
        allowed = false;
        expect(
            (await request(app).get('/guilds/two/modules/audio/clips')).status
        ).toBe(403);
        expect(
            (
                await request(app)
                    .post('/guilds/two/modules/audio/clips')
                    .set('Content-Type', 'audio/wav')
                    .send(pcmWave())
            ).status
        ).toBe(403);
        expect(db.audioClip.findMany).not.toHaveBeenCalled();
        expect(storeClip).not.toHaveBeenCalled();
    });
    it('returns only scoped clip metadata and rejects oversized upload bodies', async () => {
        (db.audioClip.findMany as jest.Mock).mockResolvedValue([]);
        expect(
            (await request(app).get('/guilds/one/modules/audio/clips')).status
        ).toBe(200);
        expect(db.audioClip.findMany).toHaveBeenCalledWith({
            where: { guildId: 'one' },
            select: clipSelect,
            orderBy: { title: 'asc' },
            take: 100,
        });
        expect(clipSelect).not.toHaveProperty('data');
        expect(
            (
                await request(app)
                    .post('/guilds/one/modules/audio/clips')
                    .set('Content-Type', 'audio/wav')
                    .send(Buffer.alloc(3 * 1024 * 1024 + 1))
            ).status
        ).toBe(413);
        expect(storeClip).not.toHaveBeenCalled();
    });
});
