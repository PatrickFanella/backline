import express from 'express';
import request from 'supertest';

jest.mock('../../../src/middleware', () => ({
    requireAuthOrApiKey: (
        req: express.Request,
        _res: express.Response,
        next: express.NextFunction
    ) => {
        req.user = {
            userId: 'automation-user',
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
import automationRoutes from '../../../src/routes/managedAutomation';
import { env } from '../../../src/utils/env';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;

databaseTests('managed automation routes', () => {
    const guildId = '777777777777777861';
    const actorId = '777777777777777863';
    const app = express();
    let priorGuilds: string[];
    app.use(express.json());
    app.use(automationRoutes);

    beforeAll(() => {
        priorGuilds = [...env.BOT_GUILD_IDS];
        env.BOT_GUILD_IDS.push(guildId);
    });
    beforeEach(async () => {
        await db.guildInstallation.create({
            data: { guildId, name: 'Automation fixture', active: true },
        });
        await moduleRegistry.configure(guildId, 'integrations', true, {});
        await moduleRegistry.configure(
            guildId,
            'scheduled-utilities',
            true,
            {}
        );
    });
    afterEach(async () => {
        await db.jobAttempt.deleteMany({ where: { job: { guildId } } });
        await db.durableJob.deleteMany({ where: { guildId } });
        await db.providerEvent.deleteMany({ where: { guildId } });
        await db.providerFeed.deleteMany({ where: { guildId } });
        await db.scheduledUtility.deleteMany({ where: { guildId } });
        await db.announcementSeries.deleteMany({ where: { guildId } });
        await db.guildModuleConfig.deleteMany({ where: { guildId } });
        await db.guildInstallation.deleteMany({ where: { guildId } });
    });
    afterAll(async () => {
        env.BOT_GUILD_IDS.splice(0, env.BOT_GUILD_IDS.length, ...priorGuilds);
        await db.$disconnect();
    });

    it('pauses a feed after integrations are disabled and cancels its pending delivery', async () => {
        const feed = await db.providerFeed.create({
            data: {
                guildId,
                actorId,
                provider: 'rss',
                source: 'https://example.test/feed',
                channelId: '777777777777777864',
            },
        });
        const event = await db.providerEvent.create({
            data: {
                guildId,
                feedId: feed.id,
                externalId: 'item',
                title: 'Item',
                url: 'https://example.test/item',
                publishedAt: new Date(),
                state: 'PENDING',
            },
        });
        await db.durableJob.create({
            data: {
                guildId,
                actorId,
                moduleId: 'integrations',
                kind: 'provider-notification',
                idempotencyKey: `provider-event:${event.id}`,
                payload: { eventId: event.id },
                expiresAt: new Date(Date.now() + 86400000),
            },
        });
        await moduleRegistry.configure(guildId, 'integrations', false, {});

        await request(app)
            .patch(`/guilds/${guildId}/automation/feeds/${feed.id}`)
            .send({ enabled: false })
            .expect(200);

        await expect(
            db.providerFeed.findUniqueOrThrow({ where: { id: feed.id } })
        ).resolves.toMatchObject({ enabled: false });
        await expect(
            db.providerEvent.findUniqueOrThrow({ where: { id: event.id } })
        ).resolves.toMatchObject({ state: 'CANCELLED' });
        const history = await request(app)
            .get(`/guilds/${guildId}/automation/feeds`)
            .expect(200);
        expect(history.body.events).toEqual([
            expect.objectContaining({
                id: event.id,
                delivery: expect.objectContaining({ state: 'CANCELLED' }),
            }),
        ]);
        await expect(
            db.durableJob.findFirstOrThrow({ where: { guildId } })
        ).resolves.toMatchObject({ state: 'CANCELLED' });
    });

    it('resumes only a paused weekly series on its original local weekday', async () => {
        const start = new Date(Date.now() - 21 * 86400000);
        const localTime = `${start.toISOString().slice(0, 10)}T12:00`;
        const series = await db.announcementSeries.create({
            data: {
                guildId,
                actorId,
                requestId: 'paused-weekly',
                channelId: '777777777777777864',
                content: 'Weekly',
                timeZone: 'UTC',
                localTime,
                cadence: 'weekly',
                ambiguity: 'earlier',
                nextAt: new Date(`${localTime}:00Z`),
                endsAt: new Date(Date.now() + 30 * 86400000),
                state: 'PAUSED',
            },
        });

        await request(app)
            .patch(`/guilds/${guildId}/automation/announcements/${series.id}`)
            .send({ action: 'resume' })
            .expect(200);

        const event = await db.scheduledUtility.findFirstOrThrow({
            where: { guildId, seriesId: series.id },
        });
        expect(new Date(`${event.localTime}:00Z`).getUTCDay()).toBe(
            new Date(`${localTime}:00Z`).getUTCDay()
        );
        expect(
            (
                await db.announcementSeries.findUniqueOrThrow({
                    where: { id: series.id },
                })
            ).localTime
        ).toBe(localTime);
    });
    it('keeps a repeated create request to one series, event, and job', async () => {
        const local = new Date(Date.now() + 86400000)
            .toISOString()
            .slice(0, 16);
        const body = {
            channelId: '777777777777777864',
            content: 'Once',
            local,
            timeZone: 'UTC',
            cadence: 'daily',
            days: 30,
            disambiguation: 'earlier',
            requestId: '11111111-1111-4111-8111-111111111111',
        };
        const first = await request(app)
            .post(`/guilds/${guildId}/automation/announcements`)
            .send(body);
        expect(first.body).toEqual(
            expect.objectContaining({ id: expect.any(String) })
        );
        const repeated = await request(app)
            .post(`/guilds/${guildId}/automation/announcements`)
            .send(body)
            .expect(201);
        await request(app)
            .post(`/guilds/${guildId}/automation/announcements`)
            .send({
                ...body,
                requestId: '22222222-2222-4222-8222-222222222222',
            })
            .expect(201);
        expect(repeated.body.id).toBe(first.body.id);
        expect(await db.announcementSeries.count({ where: { guildId } })).toBe(
            2
        );
        expect(await db.scheduledUtility.count({ where: { guildId } })).toBe(2);
        expect(
            await db.durableJob.count({
                where: { guildId, kind: 'scheduled-utility' },
            })
        ).toBe(2);
    });
});
