import express from 'express';
import request from 'supertest';

jest.mock('../../../src/middleware', () => ({
    requireAuthOrApiKey: (
        req: express.Request,
        _res: express.Response,
        next: express.NextFunction
    ) => {
        req.user = {
            userId: 'recovery-user',
            discordId: '777777777777777863',
            access: true,
            role: 'USER',
        };
        next();
    },
    requireGuildAccess: (
        _req: express.Request,
        _res: express.Response,
        next: express.NextFunction
    ) => next(),
}));

import { db } from '../../../src/db';
import { moduleRegistry } from '../../../src/modules/registry';
import recoveryControls from '../../../src/routes/recoveryControls';
import { env } from '../../../src/utils/env';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('recovery control transport', () => {
    const guildId = '777777777777777861';
    const planId = '11111111-1111-4111-8111-111111111111';
    const requestId = '22222222-2222-4222-8222-222222222222';
    const app = express();
    let priorGuilds: string[];
    app.use(express.json());
    app.use(recoveryControls);
    beforeAll(() => {
        priorGuilds = [...env.BOT_GUILD_IDS];
        env.BOT_GUILD_IDS.push(guildId);
    });
    beforeEach(async () => {
        await db.guildInstallation.create({
            data: { guildId, name: 'Recovery route fixture', active: true },
        });
        await moduleRegistry.configure(guildId, 'recovery', true, {});
    });
    afterEach(async () => {
        await db.jobAttempt.deleteMany({ where: { job: { guildId } } });
        await db.durableJob.deleteMany({ where: { guildId } });
        await db.guildModuleConfig.deleteMany({ where: { guildId } });
        await db.guildInstallation.deleteMany({ where: { guildId } });
    });
    afterAll(async () => {
        env.BOT_GUILD_IDS.splice(0, env.BOT_GUILD_IDS.length, ...priorGuilds);
        await db.$disconnect();
    });
    it('keeps a repeated apply request idempotent but gives a paused-plan continuation a fresh transport job', async () => {
        const body = {
            confirmation: `RESTORE ${guildId} ${planId}`,
            requestId,
        };
        const first = await request(app)
            .post(`/guilds/${guildId}/modules/recovery/plans/${planId}/apply`)
            .send(body)
            .expect(202);
        const repeated = await request(app)
            .post(`/guilds/${guildId}/modules/recovery/plans/${planId}/apply`)
            .send(body)
            .expect(202);
        const continued = await request(app)
            .post(`/guilds/${guildId}/modules/recovery/plans/${planId}/apply`)
            .send({
                ...body,
                requestId: '33333333-3333-4333-8333-333333333333',
            })
            .expect(202);
        expect(repeated.body.jobId).toBe(first.body.jobId);
        expect(continued.body.jobId).not.toBe(first.body.jobId);
        expect(
            await db.durableJob.count({
                where: { guildId, kind: 'restore-apply-request' },
            })
        ).toBe(2);
    });
});
