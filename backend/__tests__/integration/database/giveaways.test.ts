import { Client, Collection } from 'discord.js';
import express from 'express';
import request from 'supertest';

import {
    announceDraw,
    createGiveaway,
    drawGiveaway,
    enterGiveaway,
    recoverGiveaways,
} from '../../../src/community/giveaways';
import { db } from '../../../src/db';
import { moduleRegistry } from '../../../src/modules/registry';
import giveawayRoutes from '../../../src/routes/giveaways';
import { generateAccessToken } from '../../../src/utils/auth';
import { env } from '../../../src/utils/env';

jest.mock('../../../src/guilds/authorization', () => ({
    authorizeGuild: jest.fn((_userId: string, guildId: string) =>
        Promise.resolve(guildId === '777777777777777781')
    ),
}));

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('durable giveaway draws', () => {
    const guildId = '777777777777777781',
        actorId = '777777777777777782',
        channelId = '777777777777777783',
        roleId = '777777777777777784';
    const members = new Map<
        string,
        {
            id: string;
            user: { bot: boolean };
            joinedTimestamp: number;
            roles: { cache: Collection<string, unknown> };
            permissions: { has: () => boolean };
        }
    >();
    const edit = jest.fn().mockResolvedValue(undefined);
    const send = jest.fn().mockResolvedValue({ id: '777777777777777785' });
    const bot = { id: '777777777777777786' };
    const channel = {
        id: channelId,
        type: 0,
        send,
        permissionsFor: () => ({ has: () => true }),
        messages: { fetch: jest.fn().mockResolvedValue({ author: bot, edit }) },
    };
    const guild = {
        id: guildId,
        ownerId: actorId,
        roles: { fetch: jest.fn().mockResolvedValue({ id: roleId }) },
        channels: { fetch: jest.fn().mockResolvedValue(channel) },
        members: {
            fetchMe: jest.fn().mockResolvedValue(bot),
            fetch: jest
                .fn()
                .mockImplementation(({ user }: { user: string }) => {
                    const member = members.get(user);
                    if (!member) {
                        const error = Object.assign(
                            new Error('Unknown member'),
                            { code: 10007 }
                        );
                        return Promise.reject(error);
                    }
                    return Promise.resolve(member);
                }),
        },
    };
    const client = {
        guilds: { fetch: jest.fn().mockResolvedValue(guild) },
    } as unknown as Client;
    let oldGuilds: string[];
    const input = () => ({
        channelId,
        prize: 'Fixture prize',
        requiredRoles: [roleId],
        winnerCount: 1,
        endsAt: new Date(Date.now() + 60000),
    });
    function addMember(memberId: string) {
        members.set(memberId, {
            id: memberId,
            user: { bot: false },
            joinedTimestamp: Date.now() - 10 * 86400000,
            roles: { cache: new Collection([[roleId, {}]]) },
            permissions: { has: () => false },
        });
    }
    beforeAll(() => {
        oldGuilds = [...env.BOT_GUILD_IDS];
        env.BOT_GUILD_IDS.push(guildId);
    });
    beforeEach(async () => {
        jest.clearAllMocks();
        members.clear();
        addMember(actorId);
        send.mockResolvedValue({ id: '777777777777777785' });
        edit.mockResolvedValue(undefined);
        await db.guildInstallation.create({
            data: { guildId, name: 'Giveaway fixture', active: true },
        });
        await moduleRegistry.configure(guildId, 'giveaways', true, {});
    });
    afterEach(async () => {
        await db.durableJob.deleteMany({ where: { guildId } });
        await db.giveaway.deleteMany({ where: { guildId } });
        await db.guildModuleConfig.deleteMany({ where: { guildId } });
        await db.guildInstallation.deleteMany({ where: { guildId } });
    });
    afterAll(async () => {
        env.BOT_GUILD_IDS.splice(0, env.BOT_GUILD_IDS.length, ...oldGuilds);
        await db.$disconnect();
    });
    async function deadline(giveawayId: string) {
        await db.giveaway.update({
            where: { id: giveawayId },
            data: { endsAt: new Date(Date.now() - 1000) },
        });
    }
    it('persists only one winner set for competing draws and idempotent entries', async () => {
        const giveaway = await createGiveaway(
            client,
            guildId,
            actorId,
            'create-1',
            input()
        );
        for (const memberId of ['777777777777777791', '777777777777777792']) {
            addMember(memberId);
            await Promise.all([
                enterGiveaway(client, guildId, giveaway.id, memberId),
                enterGiveaway(client, guildId, giveaway.id, memberId),
            ]);
        }
        expect(
            await db.giveawayEntry.count({ where: { giveawayId: giveaway.id } })
        ).toBe(2);
        await deadline(giveaway.id);
        const draws = await Promise.all([
            drawGiveaway(client, guildId, giveaway.id, actorId, 'draw-1'),
            drawGiveaway(client, guildId, giveaway.id, actorId, 'draw-2'),
        ]);
        expect(draws[0].id).toBe(draws[1].id);
        expect(draws[0].winners).toHaveLength(1);
        expect(
            await db.giveawayDraw.count({ where: { giveawayId: giveaway.id } })
        ).toBe(1);
        await expect(
            enterGiveaway(client, guildId, giveaway.id, actorId)
        ).rejects.toThrow('closed');
    });
    it('checks role loss and departures at draw time, and preserves recorded rerolls', async () => {
        const giveaway = await createGiveaway(
            client,
            guildId,
            actorId,
            'create-2',
            input()
        );
        const entrants = [
            '777777777777777791',
            '777777777777777792',
            '777777777777777793',
            '777777777777777794',
        ];
        for (const memberId of entrants) {
            addMember(memberId);
            await enterGiveaway(client, guildId, giveaway.id, memberId);
        }
        members.get(entrants[2])!.roles.cache.clear();
        members.delete(entrants[3]);
        await deadline(giveaway.id);
        const first = await drawGiveaway(
            client,
            guildId,
            giveaway.id,
            actorId,
            'draw-role'
        );
        expect(first.eligibleCount).toBe(2);
        expect(entrants.slice(0, 2)).toContain(first.winners[0]);
        await announceDraw(client, guildId, first);
        const second = await drawGiveaway(
            client,
            guildId,
            giveaway.id,
            actorId,
            'reroll-role',
            true
        );
        expect(second.winners).toHaveLength(1);
        expect(second.winners[0]).not.toBe(first.winners[0]);
        await announceDraw(client, guildId, second);
        expect(
            await db.giveawayDraw.count({ where: { giveawayId: giveaway.id } })
        ).toBe(2);
        expect(
            (
                await drawGiveaway(
                    client,
                    guildId,
                    giveaway.id,
                    actorId,
                    'reroll-role',
                    true
                )
            ).id
        ).toBe(second.id);
        await announceDraw(client, guildId, first);
        expect(edit).toHaveBeenCalledTimes(2);
    });
    it('recovers a missing scheduled job after restart without duplicating the announcement', async () => {
        const giveaway = await createGiveaway(
            client,
            guildId,
            actorId,
            'create-restart',
            input()
        );
        await deadline(giveaway.id);
        await db.durableJob.deleteMany({ where: { guildId } });
        await recoverGiveaways();
        await recoverGiveaways();
        const jobs = await db.durableJob.findMany({ where: { guildId } });
        expect(jobs).toHaveLength(1);
        expect(jobs[0].runAt.getTime()).toBeLessThan(Date.now());
        expect(send).toHaveBeenCalledTimes(1);
    });
    it('holds uncertain initial delivery instead of sending a second announcement', async () => {
        send.mockRejectedValueOnce(new Error('Connection lost'));
        const data = input();
        await expect(
            createGiveaway(client, guildId, actorId, 'create-held', data)
        ).rejects.toThrow('Connection lost');
        expect(
            (
                await createGiveaway(
                    client,
                    guildId,
                    actorId,
                    'create-held',
                    data
                )
            ).state
        ).toBe('CREATING');
        expect(send).toHaveBeenCalledTimes(1);
        expect(await db.durableJob.count({ where: { guildId } })).toBe(0);
    });
    it('resumes an uncertain result edit with the persisted winner set', async () => {
        const giveaway = await createGiveaway(
            client,
            guildId,
            actorId,
            'create-edit',
            input()
        );
        addMember('777777777777777791');
        await enterGiveaway(client, guildId, giveaway.id, '777777777777777791');
        await deadline(giveaway.id);
        const draw = await drawGiveaway(
            client,
            guildId,
            giveaway.id,
            actorId,
            'draw-edit'
        );
        edit.mockRejectedValueOnce(new Error('Edit connection lost'));
        await expect(announceDraw(client, guildId, draw)).rejects.toThrow(
            'Edit connection lost'
        );
        await expect(
            drawGiveaway(
                client,
                guildId,
                giveaway.id,
                actorId,
                'reroll-too-early',
                true
            )
        ).rejects.toThrow('Deliver');
        await announceDraw(client, guildId, draw);
        expect(
            (
                await db.giveawayDraw.findUniqueOrThrow({
                    where: { id: draw.id },
                })
            ).announcement
        ).toBe('DELIVERED');
        expect(
            await db.giveawayDraw.count({ where: { giveawayId: giveaway.id } })
        ).toBe(1);
        expect(edit.mock.calls[0][0]).toEqual(edit.mock.calls[1][0]);
    });
    it('supports withdrawal and enforces active and entry quotas', async () => {
        await moduleRegistry.configure(guildId, 'giveaways', true, {
            maxActive: 1,
            maxEntries: 1,
        });
        const giveaway = await createGiveaway(
            client,
            guildId,
            actorId,
            'create-quota',
            input()
        );
        await expect(
            createGiveaway(client, guildId, actorId, 'create-extra', input())
        ).rejects.toThrow('quota');
        addMember('777777777777777791');
        addMember('777777777777777792');
        await enterGiveaway(client, guildId, giveaway.id, '777777777777777791');
        await expect(
            enterGiveaway(client, guildId, giveaway.id, '777777777777777792')
        ).rejects.toThrow('quota');
        await enterGiveaway(
            client,
            guildId,
            giveaway.id,
            '777777777777777791',
            true
        );
        await enterGiveaway(client, guildId, giveaway.id, '777777777777777792');
        expect(
            await db.giveawayEntry.count({ where: { giveawayId: giveaway.id } })
        ).toBe(1);
    });
    it('denies outsiders, disabled modules and uncertain eligibility reads', async () => {
        addMember('777777777777777791');
        await expect(
            createGiveaway(
                client,
                guildId,
                '777777777777777791',
                'unauthorized',
                input()
            )
        ).rejects.toThrow('Manage Server');
        const giveaway = await createGiveaway(
            client,
            guildId,
            actorId,
            'create-deny',
            input()
        );
        await enterGiveaway(client, guildId, giveaway.id, '777777777777777791');
        await deadline(giveaway.id);
        guild.members.fetch
            .mockResolvedValueOnce(members.get(actorId))
            .mockRejectedValueOnce(new Error('Network unavailable'));
        await expect(
            drawGiveaway(client, guildId, giveaway.id, actorId, 'draw-outage')
        ).rejects.toThrow('Network unavailable');
        expect(
            await db.giveawayDraw.count({ where: { giveawayId: giveaway.id } })
        ).toBe(0);
        await moduleRegistry.configure(guildId, 'giveaways', false, {});
        await expect(
            drawGiveaway(client, guildId, giveaway.id, actorId, 'draw-disabled')
        ).rejects.toThrow('disabled');
    });
    it('queues dashboard creation once and denies cross-server access', async () => {
        const app = express();
        app.use(express.json());
        app.use(giveawayRoutes);
        const token = generateAccessToken({
            userId: 'giveaway-api-fixture',
            discordId: actorId,
            access: true,
            role: 'USER',
        });
        const body = {
            ...input(),
            endsAt: input().endsAt.toISOString(),
            requestId: '00000000-0000-4000-8000-000000000001',
        };
        const first = await request(app)
            .post(`/guilds/${guildId}/giveaways`)
            .set('Authorization', `Bearer ${token}`)
            .send(body)
            .expect(202);
        const second = await request(app)
            .post(`/guilds/${guildId}/giveaways`)
            .set('Authorization', `Bearer ${token}`)
            .send(body)
            .expect(202);
        expect(second.body.id).toBe(first.body.id);
        const job = await db.durableJob.findUniqueOrThrow({
            where: { id: first.body.id },
        });
        expect(job.actorId).toBe(actorId);
        expect(job.kind).toBe('giveaway-create');
        expect(job.state).toBe('PENDING');
        await request(app).get(`/guilds/${guildId}/giveaways`).expect(401);
        await request(app)
            .get('/guilds/777777777777777799/giveaways')
            .set('Authorization', `Bearer ${token}`)
            .expect(403);
        await request(app)
            .post('/guilds/777777777777777799/giveaways')
            .set('Authorization', `Bearer ${token}`)
            .send(body)
            .expect(403);
        await request(app)
            .get(`/guilds/${guildId}/giveaways`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200, []);
    });
    it('rejects an actor whose application access was revoked after queueing', async () => {
        const account = await db.user.create({
            data: {
                discordId: actorId,
                username: 'giveaway-banned-fixture',
                discriminator: '0',
                role: 'BANNED',
                verified: false,
                accessToken: 'fixture-access',
                refreshToken: 'fixture-refresh',
                accessTokenExpiresAt: new Date(Date.now() + 60000),
                lastSeenAt: new Date(),
            },
        });
        try {
            await expect(
                createGiveaway(
                    client,
                    guildId,
                    actorId,
                    'banned-actor',
                    input()
                )
            ).rejects.toThrow('revoked');
            expect(send).not.toHaveBeenCalled();
        } finally {
            await db.user.delete({ where: { id: account.id } });
        }
    });
});
