import { Client, Collection } from 'discord.js';
import express from 'express';
import request from 'supertest';

import { levelingConfig } from '../../../src/community/config';
import {
    expireLeveling,
    grantXp,
    leaderboard,
    levelingHandler,
    profile,
    VoiceClock,
} from '../../../src/community/leveling';
import { db } from '../../../src/db';
import { moduleRegistry } from '../../../src/modules/registry';
import guildModulesRoutes from '../../../src/routes/guildModules';
import levelingRoutes from '../../../src/routes/leveling';
import { generateAccessToken } from '../../../src/utils/auth';
import { env } from '../../../src/utils/env';

jest.mock('../../../src/guilds/authorization', () => ({
    authorizeGuild: jest.fn((_userId: string, guildId: string) =>
        Promise.resolve(guildId === '777777777777777801')
    ),
}));
const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('persistent server leveling', () => {
    const guildId = '777777777777777801',
        otherGuild = '777777777777777802',
        memberId = '777777777777777803',
        roleId = '777777777777777804';
    let oldGuilds: string[],
        oldMessage: boolean,
        oldContent: boolean,
        oldVoice: boolean;
    const event = (overrides: Record<string, unknown> = {}) => ({
        guildId,
        memberId,
        requestId: 'message:1',
        displayName: 'Fixture member',
        channelId: '777777777777777805',
        roleIds: [] as string[],
        bot: false,
        source: 'MESSAGE' as const,
        content: 'A fresh message',
        at: new Date(),
        ...overrides,
    });
    beforeAll(() => {
        oldGuilds = [...env.BOT_GUILD_IDS];
        oldMessage = env.BOT_MESSAGE_INTENTS;
        oldContent = env.BOT_MESSAGE_CONTENT_INTENT;
        oldVoice = env.BOT_VOICE_INTENT;
        env.BOT_GUILD_IDS.push(guildId, otherGuild);
        env.BOT_MESSAGE_INTENTS = true;
        env.BOT_MESSAGE_CONTENT_INTENT = true;
        env.BOT_VOICE_INTENT = true;
    });
    beforeEach(async () => {
        for (const id of [guildId, otherGuild]) {
            await db.guildInstallation.create({
                data: { guildId: id, name: 'XP fixture', active: true },
            });
            await moduleRegistry.configure(id, 'leveling', true, {});
        }
    });
    afterEach(async () => {
        const where = { guildId: { in: [guildId, otherGuild] } };
        await db.durableJob.deleteMany({ where });
        await db.levelDigest.deleteMany({ where });
        await db.levelGrant.deleteMany({ where });
        await db.levelProfile.deleteMany({ where });
        await db.guildModuleConfig.deleteMany({ where });
        await db.guildInstallation.deleteMany({ where });
    });
    afterAll(async () => {
        env.BOT_GUILD_IDS.splice(0, env.BOT_GUILD_IDS.length, ...oldGuilds);
        env.BOT_MESSAGE_INTENTS = oldMessage;
        env.BOT_MESSAGE_CONTENT_INTENT = oldContent;
        env.BOT_VOICE_INTENT = oldVoice;
        await db.$disconnect();
    });
    it('serializes competing messages and enforces cooldown and event idempotency', async () => {
        const at = new Date();
        const results = await Promise.all([
            grantXp(event({ at })),
            grantXp(
                event({
                    at,
                    requestId: 'message:2',
                    content: 'Another useful message',
                })
            ),
        ]);
        expect(results.filter(Boolean)).toHaveLength(1);
        expect((await profile(guildId, memberId))?.xp).toBe(15);
        const grant = await db.levelGrant.findFirstOrThrow({
            where: { guildId },
        });
        expect(
            await grantXp(
                event({
                    requestId: grant.requestId,
                    at: new Date(at.getTime() + 61000),
                    content: 'Distinct message after cooldown',
                })
            )
        ).toBe(false);
        expect(await db.levelGrant.count({ where: { guildId } })).toBe(1);
    });
    it('rejects normalized repeats without retaining content or exposing its private digest key', async () => {
        const at = new Date();
        expect(await grantXp(event({ at }))).toBe(true);
        expect(
            await grantXp(
                event({
                    requestId: 'message:2',
                    at: new Date(at.getTime() + 61000),
                    content: '  A   FRESH message  ',
                })
            )
        ).toBe(false);
        expect(
            await grantXp(
                event({
                    requestId: 'message:3',
                    at: new Date(at.getTime() + 62000),
                    content: 'Different useful words',
                })
            )
        ).toBe(true);
        const rows = await leaderboard(guildId);
        expect(JSON.stringify(rows)).not.toMatch(
            /digest|content|FRESH|Different/
        );
        expect(
            JSON.stringify(
                await db.levelDigest.findMany({ where: { guildId } })
            )
        ).not.toContain('message');
    });
    it('skips bots, webhooks, excluded roles/channels, short and stale messages and disabled modules', async () => {
        await moduleRegistry.configure(guildId, 'leveling', true, {
            excludedRoles: [roleId],
            excludedChannels: ['777777777777777809'],
        });
        for (const override of [
            { bot: true },
            { webhook: true },
            { roleIds: [roleId] },
            { channelId: '777777777777777809' },
            { content: 'hi' },
            { at: new Date(Date.now() - 600000) },
        ])
            expect(await grantXp(event(override))).toBe(false);
        await moduleRegistry.configure(guildId, 'leveling', false, {});
        expect(await grantXp(event())).toBe(false);
        expect(await db.levelGrant.count({ where: { guildId } })).toBe(0);
    });
    it('keeps servers separate and saves a role job atomically with earned XP', async () => {
        await moduleRegistry.configure(guildId, 'leveling', true, {
            messageXp: 100,
            rewards: [{ roleId, level: 1 }],
        });
        expect(await grantXp(event())).toBe(true);
        expect(await grantXp(event({ guildId: otherGuild }))).toBe(true);
        expect((await profile(guildId, memberId))?.level).toBe(1);
        expect((await profile(otherGuild, memberId))?.xp).toBe(15);
        const job = await db.durableJob.findFirstOrThrow({
            where: { guildId },
        });
        expect(job.kind).toBe('level-reward');
        expect(job.payload).toEqual({ memberId, roleId, level: 1 });
        expect(await grantXp(event())).toBe(false);
        expect(await db.durableJob.count({ where: { guildId } })).toBe(1);
    });
    it('rechecks role hierarchy and reconciles a delivered role without assigning it twice', async () => {
        await moduleRegistry.configure(guildId, 'leveling', true, {
            messageXp: 100,
            rewards: [{ roleId, level: 1 }],
        });
        await grantXp(event());
        const job = await db.durableJob.findFirstOrThrow({
            where: { guildId },
        });
        const add = jest.fn().mockResolvedValue(undefined),
            roles = new Collection<string, never>();
        let position = -1;
        const guild = {
            id: guildId,
            roles: {
                fetch: jest.fn().mockResolvedValue({
                    id: roleId,
                    guild: { id: guildId },
                    managed: false,
                    permissions: { bitfield: BigInt(0) },
                }),
            },
            members: {
                fetch: jest.fn().mockResolvedValue({
                    user: { bot: false },
                    roles: { cache: roles, add },
                }),
                fetchMe: jest.fn().mockImplementation(() =>
                    Promise.resolve({
                        permissions: { has: () => true },
                        roles: {
                            highest: { comparePositionTo: () => position },
                        },
                    })
                ),
            },
        };
        const client = {
            guilds: { fetch: jest.fn().mockResolvedValue(guild) },
        } as unknown as Client;
        const handler = levelingHandler(client);
        await expect(handler.execute(job)).rejects.toThrow('above');
        expect(add).not.toHaveBeenCalled();
        position = 1;
        expect((await handler.execute(job)).state).toBe('DELIVERED');
        expect(add).toHaveBeenCalledTimes(1);
        roles.set(roleId, {} as never);
        expect((await handler.reconcile(job)).state).toBe('DELIVERED');
        expect(add).toHaveBeenCalledTimes(1);
        await moduleRegistry.configure(guildId, 'leveling', true, {});
        expect((await handler.execute(job)).state).toBe('CANCELLED');
    });
    it('expires inactive profiles and content digests while retaining an active total', async () => {
        await grantXp(event());
        await grantXp(event({ guildId: otherGuild }));
        await db.levelProfile.update({
            where: { guildId_memberId: { guildId, memberId } },
            data: { updatedAt: new Date(Date.now() - 91 * 86400000) },
        });
        await db.levelDigest.updateMany({
            where: { guildId: otherGuild },
            data: { expiresAt: new Date(Date.now() - 1000) },
        });
        await expireLeveling();
        expect(await profile(guildId, memberId)).toBeNull();
        expect((await profile(otherGuild, memberId))?.xp).toBe(15);
        expect(
            await db.levelDigest.count({ where: { guildId: otherGuild } })
        ).toBe(0);
    });
    it('authorizes the dashboard server before exposing its leaderboard', async () => {
        await grantXp(event());
        const app = express();
        app.use(levelingRoutes);
        const token = generateAccessToken({
            userId: 'level-api-fixture',
            discordId: memberId,
            access: true,
            role: 'USER',
        });
        await request(app).get(`/guilds/${guildId}/leveling`).expect(401);
        await request(app)
            .get(`/guilds/${otherGuild}/leveling`)
            .set('Authorization', `Bearer ${token}`)
            .expect(403);
        const response = await request(app)
            .get(`/guilds/${guildId}/leveling`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
        expect(response.body.profile.xp).toBe(15);
        expect(JSON.stringify(response.body)).not.toMatch(
            /digestKey|digest|content/
        );
    });
    it('rolls back an XP grant when the reward queue is full', async () => {
        await moduleRegistry.configure(guildId, 'leveling', true, {
            messageXp: 100,
            rewards: [{ roleId, level: 1 }],
        });
        await db.durableJob.createMany({
            data: Array.from({ length: 1000 }, (_, index) => ({
                guildId,
                actorId: memberId,
                kind: 'fixture',
                idempotencyKey: `capacity:${index}`,
                payload: {},
                runAt: new Date(),
                expiresAt: new Date(Date.now() + 60000),
            })),
        });
        await expect(grantXp(event())).rejects.toThrow('queue full');
        expect(await profile(guildId, memberId)).toBeNull();
        expect(await db.levelGrant.count({ where: { guildId } })).toBe(0);
        expect(await db.levelDigest.count({ where: { guildId } })).toBe(0);
    });
    it('requires Voice States when enabling voice awards and Manage Roles when authoring rewards', async () => {
        env.BOT_VOICE_INTENT = false;
        try {
            await expect(
                moduleRegistry.configure(guildId, 'leveling', true, {
                    voiceEnabled: true,
                })
            ).rejects.toThrow('Voice Gateway');
        } finally {
            env.BOT_VOICE_INTENT = true;
        }
        const app = express();
        app.use(express.json());
        app.use(guildModulesRoutes);
        const token = generateAccessToken({
            userId: 'level-api-fixture',
            discordId: memberId,
            access: true,
            role: 'USER',
        });
        await request(app)
            .put(`/guilds/${guildId}/modules/leveling`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                enabled: true,
                config: { rewards: [{ roleId, level: 1 }] },
            })
            .expect(403);
        const row = await db.guildModuleConfig.findUniqueOrThrow({
            where: { guildId_moduleId: { guildId, moduleId: 'leveling' } },
        });
        expect(levelingConfig.parse(row.config).rewards).toEqual([]);
    });
    it('awards voice independently of message cooldown and deduplicates each voice minute', async () => {
        await moduleRegistry.configure(guildId, 'leveling', true, {
            voiceEnabled: true,
        });
        const at = new Date();
        await grantXp(event({ at }));
        const voice = event({ source: 'VOICE', requestId: 'voice:1', at });
        expect(await grantXp(voice)).toBe(true);
        expect(await grantXp(voice)).toBe(false);
        expect(
            await grantXp(
                event({
                    source: 'VOICE',
                    requestId: 'voice:2',
                    at: new Date(at.getTime() + 30000),
                })
            )
        ).toBe(false);
        expect((await profile(guildId, memberId))?.xp).toBe(18);
    });
});
describe('continuous voice eligibility', () => {
    const config = levelingConfig.parse({ voiceEnabled: true });
    const member = {
        memberId: 'member',
        channelId: 'voice',
        bot: false,
        afk: false,
        deafened: false,
        muted: false,
        humans: 2,
        roleIds: [],
        displayName: 'Member',
    };
    it('requires a full eligible minute and resets on AFK, deafening, solo presence, moves and restart', () => {
        const clock = new VoiceClock();
        expect(clock.sample('server', [member], config, 0)).toEqual([]);
        expect(clock.sample('server', [member], config, 60000)).toEqual([
            member,
        ]);
        for (const override of [
            { afk: true },
            { deafened: true },
            { muted: true },
            { humans: 1 },
            { bot: true },
        ]) {
            expect(
                clock.sample(
                    'server',
                    [{ ...member, ...override }],
                    config,
                    120000
                )
            ).toEqual([]);
            expect(clock.sample('server', [member], config, 150000)).toEqual(
                []
            );
        }
        expect(
            clock.sample(
                'server',
                [{ ...member, channelId: 'moved' }],
                config,
                210000
            )
        ).toEqual([]);
        expect(
            new VoiceClock().sample('server', [member], config, 999999)
        ).toEqual([]);
    });
    it('clears a removed member and keeps independent server clocks', () => {
        const clock = new VoiceClock();
        clock.sample('a', [member], config, 0);
        clock.sample('b', [member], config, 0);
        clock.sample('a', [], config, 60000);
        expect(clock.sample('a', [member], config, 60000)).toEqual([]);
        expect(clock.sample('b', [member], config, 60000)).toEqual([member]);
    });
});
