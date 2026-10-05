import { Client } from 'discord.js';
import express from 'express';
import request from 'supertest';

import {
    communityCounterHandler,
    communityReport,
    maintainCommunityReports,
    recordCommunityCoverage,
    recordCommunityEvent,
    scheduleCommunityCounters,
} from '../../../src/community/reports';
import { db } from '../../../src/db';
import { moduleRegistry } from '../../../src/modules/registry';
import communityReportRoutes from '../../../src/routes/communityReports';
import guildModulesRoutes from '../../../src/routes/guildModules';
import { generateAccessToken } from '../../../src/utils/auth';
import { env } from '../../../src/utils/env';

jest.mock('../../../src/guilds/authorization', () => ({
    authorizeGuild: jest.fn((_userId: string, guildId: string) =>
        Promise.resolve(guildId === '777777777777777821')
    ),
}));
const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('community reports and durable counters', () => {
    const guildId = '777777777777777821',
        otherGuild = '777777777777777822',
        memberId = '777777777777777823',
        channelId = '777777777777777824';
    let oldGuilds: string[], oldMessage: boolean, oldMembers: boolean;
    const range = () => {
        const to = new Date(Math.floor(Date.now() / 60000) * 60000);
        return { from: new Date(to.getTime() - 180000), to };
    };
    const event = (eventId: string, extra = {}) => ({
        guildId,
        memberId,
        channelId,
        eventId,
        kind: 'messages' as const,
        at: new Date(),
        ...extra,
    });
    const counter = {
        channelId,
        metric: 'messages',
        days: 1,
        intervalMinutes: 60,
    };
    beforeAll(() => {
        oldGuilds = [...env.BOT_GUILD_IDS];
        oldMessage = env.BOT_MESSAGE_INTENTS;
        oldMembers = env.BOT_MEMBER_INTENTS;
        env.BOT_GUILD_IDS.push(guildId, otherGuild);
        env.BOT_MESSAGE_INTENTS = true;
        env.BOT_MEMBER_INTENTS = true;
    });
    beforeEach(async () => {
        for (const id of [guildId, otherGuild]) {
            await db.guildInstallation.create({
                data: { guildId: id, name: 'Report fixture', active: true },
            });
            await moduleRegistry.configure(id, 'community-reports', true, {});
        }
    });
    afterEach(async () => {
        const where = { guildId: { in: [guildId, otherGuild] } };
        await db.durableJob.deleteMany({ where });
        await db.communityObservation.deleteMany({ where });
        await db.communityCoverage.deleteMany({ where });
        await db.communityCohort.deleteMany({ where });
        await db.communityCounter.deleteMany({ where });
        await db.guildModuleConfig.deleteMany({ where });
        await db.guildInstallation.deleteMany({ where });
    });
    afterAll(async () => {
        env.BOT_GUILD_IDS.splice(0, env.BOT_GUILD_IDS.length, ...oldGuilds);
        env.BOT_MESSAGE_INTENTS = oldMessage;
        env.BOT_MEMBER_INTENTS = oldMembers;
        await db.$disconnect();
    });
    async function cover(from: Date, to: Date) {
        for (let at = from.getTime(); at < to.getTime(); at += 60000)
            await recordCommunityCoverage(guildId, new Date(at));
    }
    it('reconciles server/time totals, channel counts and join cohort departures with idempotent observations', async () => {
        const { from, to } = range(),
            at = new Date(from.getTime() + 1000),
            joinedAt = at;
        await cover(from, to);
        const results = await Promise.all([
            recordCommunityEvent(event('a', { at })),
            recordCommunityEvent(event('a', { at })),
        ]);
        expect(results.filter(Boolean)).toHaveLength(1);
        await recordCommunityEvent(
            event('b', { at, memberId: '777777777777777825' })
        );
        await recordCommunityEvent(
            event('outside', { guildId: otherGuild, at })
        );
        await recordCommunityEvent(
            event('join-a', { kind: 'joins', at, joinedAt })
        );
        await recordCommunityEvent(
            event('join-b', {
                kind: 'joins',
                at,
                joinedAt,
                memberId: '777777777777777825',
            })
        );
        await recordCommunityEvent(
            event('leave-a', {
                kind: 'departures',
                joinedAt,
                at: new Date(from.getTime() + 120000),
            })
        );
        const report = await communityReport(guildId, { from, to });
        expect(report.coverage.status).toBe('OBSERVED');
        expect(report.totals).toEqual({
            messages: 2,
            joins: 2,
            departures: 1,
            activeMembers: 2,
        });
        expect(report.channels).toEqual([{ channelId, messages: 2 }]);
        expect(report.days.reduce((total, day) => total + day.count, 0)).toBe(
            5
        );
        expect(report.cohort).toEqual({
            observedJoins: 2,
            observedDepartures: 1,
            retentionRate: 0.5,
        });
    });
    it('distinguishes unavailable history, observed zero and gaps; unknown departures suppress retention claims', async () => {
        const { from, to } = range();
        expect(
            (await communityReport(guildId, { from, to })).totals
        ).toBeNull();
        await cover(from, to);
        const zero = await communityReport(guildId, { from, to });
        expect(zero.coverage.status).toBe('OBSERVED');
        expect(zero.totals?.messages).toBe(0);
        const at = new Date(from.getTime() + 1000);
        await recordCommunityEvent(
            event('join', { kind: 'joins', at, joinedAt: at })
        );
        await recordCommunityEvent(
            event('unknown-departure', { kind: 'departures', at })
        );
        expect(
            (await communityReport(guildId, { from, to })).cohort.retentionRate
        ).toBeNull();
        await db.communityCoverage.deleteMany({
            where: { guildId, minute: from },
        });
        expect(
            (await communityReport(guildId, { from, to })).coverage.status
        ).toBe('PARTIAL');
    });
    it('skips bots, excluded channels and disabled collectors and rejects invalid ranges', async () => {
        await moduleRegistry.configure(guildId, 'community-reports', true, {
            excludedChannels: [channelId],
        });
        expect(await recordCommunityEvent(event('excluded'))).toBe(false);
        expect(
            await recordCommunityEvent(
                event('bot', { channelId: 'other', bot: true })
            )
        ).toBe(false);
        await moduleRegistry.configure(guildId, 'community-reports', false, {});
        expect(await recordCommunityEvent(event('disabled'))).toBe(false);
        await recordCommunityCoverage(guildId);
        expect(await db.communityCoverage.count({ where: { guildId } })).toBe(
            0
        );
        await expect(
            communityReport(guildId, {
                from: new Date(),
                to: new Date(Date.now() - 1000),
            })
        ).rejects.toThrow();
    });
    it('queues each interval once and allows only one concurrent channel rename', async () => {
        await moduleRegistry.configure(guildId, 'community-reports', true, {
            counters: [counter],
        });
        await recordCommunityEvent(
            event('one', { at: new Date(Date.now() - 1000) })
        );
        await Promise.all([
            scheduleCommunityCounters(),
            scheduleCommunityCounters(),
        ]);
        expect(await db.durableJob.count({ where: { guildId } })).toBe(1);
        const job = await db.durableJob.findFirstOrThrow({
            where: { guildId },
        });
        const setName = jest.fn().mockResolvedValue(undefined);
        const channel = {
            type: 2,
            name: 'fixture-counter',
            setName,
            permissionsFor: () => ({ has: () => true }),
        };
        const client = {
            guilds: {
                fetch: jest.fn().mockResolvedValue({
                    channels: {
                        fetch: jest.fn().mockResolvedValue(channel),
                    },
                    members: { fetchMe: jest.fn().mockResolvedValue({}) },
                }),
            },
        } as unknown as Client;
        const handler = communityCounterHandler(client);
        const results = await Promise.all([
            handler.execute(job),
            handler.execute(job),
        ]);
        expect(
            results.filter((result) => result.state === 'DELIVERED')
        ).toHaveLength(1);
        expect(setName).toHaveBeenCalledTimes(1);
        expect(setName).toHaveBeenCalledWith(
            'observed-messages-1d-1',
            expect.any(String)
        );
        channel.name = 'observed-messages-1d-1';
        expect((await handler.reconcile(job)).state).toBe('DELIVERED');
        expect(setName).toHaveBeenCalledTimes(1);
    });
    it('retains a failed rename reservation and cannot resend within its interval', async () => {
        await moduleRegistry.configure(guildId, 'community-reports', true, {
            counters: [counter],
        });
        await scheduleCommunityCounters();
        const job = await db.durableJob.findFirstOrThrow({
            where: { guildId },
        });
        const setName = jest
            .fn()
            .mockRejectedValue(new Error('Network outcome uncertain'));
        const channel = {
            type: 2,
            name: 'old',
            setName,
            permissionsFor: () => ({ has: () => true }),
        };
        const client = {
            guilds: {
                fetch: jest.fn().mockResolvedValue({
                    channels: {
                        fetch: jest.fn().mockResolvedValue(channel),
                    },
                    members: { fetchMe: jest.fn().mockResolvedValue({}) },
                }),
            },
        } as unknown as Client;
        const handler = communityCounterHandler(client);
        await expect(handler.execute(job)).rejects.toThrow('uncertain');
        expect((await handler.reconcile(job)).state).toBe('RECONCILE');
        expect((await handler.execute(job)).state).toBe('CANCELLED');
        expect(setName).toHaveBeenCalledTimes(1);
        await db.durableJob.update({
            where: { id: job.id },
            data: {
                state: 'RECONCILE',
                expiresAt: new Date(Date.now() - 1000),
            },
        });
        await maintainCommunityReports();
        const expired = await db.durableJob.findUniqueOrThrow({
            where: { id: job.id },
        });
        expect(expired.state).toBe('CANCELLED');
        expect(expired.lastError).toContain('unconfirmed');
    });
    it('denies missing channel permissions and stale counter configuration', async () => {
        await moduleRegistry.configure(guildId, 'community-reports', true, {
            counters: [counter],
        });
        await scheduleCommunityCounters();
        const job = await db.durableJob.findFirstOrThrow({
            where: { guildId },
        });
        const setName = jest.fn();
        const client = {
            guilds: {
                fetch: jest.fn().mockResolvedValue({
                    channels: {
                        fetch: jest.fn().mockResolvedValue({
                            type: 2,
                            name: 'old',
                            setName,
                            permissionsFor: () => ({
                                has: () => false,
                            }),
                        }),
                    },
                    members: { fetchMe: jest.fn().mockResolvedValue({}) },
                }),
            },
        } as unknown as Client;
        await expect(
            communityCounterHandler(client).execute(job)
        ).rejects.toThrow('permissions');
        expect(setName).not.toHaveBeenCalled();
        await moduleRegistry.configure(guildId, 'community-reports', true, {});
        expect((await communityCounterHandler(client).execute(job)).state).toBe(
            'CANCELLED'
        );
    });
    it('authorizes report access and counter authorship before querying a server', async () => {
        const app = express();
        app.use(express.json());
        app.use(communityReportRoutes);
        app.use(guildModulesRoutes);
        const token = generateAccessToken({
            userId: 'report-api-fixture',
            discordId: memberId,
            access: true,
            role: 'USER',
        });
        const dates = range();
        await request(app)
            .get(`/guilds/${guildId}/community-report`)
            .query(dates)
            .expect(401);
        await request(app)
            .get(`/guilds/${otherGuild}/community-report`)
            .query(dates)
            .set('Authorization', `Bearer ${token}`)
            .expect(403);
        const response = await request(app)
            .get(`/guilds/${guildId}/community-report`)
            .query({
                from: dates.from.toISOString(),
                to: dates.to.toISOString(),
            })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
        expect(response.body.coverage.status).toBe('UNAVAILABLE');
        await request(app)
            .put(`/guilds/${guildId}/modules/community-reports`)
            .set('Authorization', `Bearer ${token}`)
            .send({ enabled: true, config: { counters: [counter] } })
            .expect(403);
    });
    it('expires observations, coverage and cohorts at the server retention boundary', async () => {
        const old = new Date(Date.now() - 31 * 86400000);
        await db.communityObservation.create({
            data: { guildId, eventId: 'old', kind: 'joins', memberId, at: old },
        });
        await db.communityCoverage.create({ data: { guildId, minute: old } });
        await db.communityCohort.create({
            data: { guildId, memberId, joinedAt: old },
        });
        await recordCommunityEvent(event('new'));
        await maintainCommunityReports();
        expect(
            await db.communityObservation.count({ where: { guildId } })
        ).toBe(1);
        expect(await db.communityCohort.count({ where: { guildId } })).toBe(0);
        expect(await db.communityCoverage.count({ where: { guildId } })).toBe(
            0
        );
    });
});
