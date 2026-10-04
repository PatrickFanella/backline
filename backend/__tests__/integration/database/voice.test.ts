import { Client, PermissionFlagsBits } from 'discord.js';

import { RadioRuntime } from '../../../src/audio/radio';
import { db } from '../../../src/db';
import { moduleRegistry } from '../../../src/modules/registry';
import { env } from '../../../src/utils/env';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const guildId = '777777777777777781',
    channelId = '777777777777777782',
    requesterId = '777777777777777783';
databaseTests('voice ownership and authorization', () => {
    beforeEach(async () => {
        env.BOT_GUILD_IDS.push(guildId);
        env.BOT_VOICE_INTENT = true;
        await db.guildInstallation.upsert({
            where: { guildId },
            create: { guildId, name: 'fixture', active: true },
            update: { active: true },
        });
        await moduleRegistry.configure(guildId, 'audio', true, {});
    });
    afterEach(async () => {
        await db.voicePlayback.deleteMany({ where: { guildId } });
        await db.guildModuleConfig.deleteMany({ where: { guildId } });
        await db.guildInstallation.delete({ where: { guildId } });
        env.BOT_GUILD_IDS.splice(env.BOT_GUILD_IDS.indexOf(guildId), 1);
        env.BOT_VOICE_INTENT = false;
    });
    afterAll(async () => {
        await db.$disconnect();
    });
    it('atomically reserves one active playback per server', async () => {
        const results = await Promise.allSettled(
            Array.from({ length: 3 }, () =>
                db.voicePlayback.create({
                    data: {
                        guildId,
                        channelId,
                        requesterId,
                        stationId: 'defcon',
                    },
                })
            )
        );
        expect(
            results.filter((result) => result.status === 'fulfilled')
        ).toHaveLength(1);
        expect(
            await db.voicePlayback.count({
                where: { guildId, state: 'STARTING' },
            })
        ).toBe(1);
    });
    it('retains interrupted history on sole-owner restart and requires an explicit new start', async () => {
        const row = await db.voicePlayback.create({
            data: {
                guildId,
                channelId,
                requesterId,
                stationId: 'defcon',
                state: 'PLAYING',
            },
        });
        const runtime = new RadioRuntime();
        await runtime.recover([guildId]);
        expect(
            (
                await db.voicePlayback.findUniqueOrThrow({
                    where: { id: row.id },
                })
            ).state
        ).toBe('INTERRUPTED');
        expect(runtime.status(guildId)).toBeNull();
        await expect(
            db.voicePlayback.create({
                data: { guildId, channelId, requesterId, stationId: 'defcon' },
            })
        ).resolves.toHaveProperty('state', 'STARTING');
    });
    it('rejects a remote channel request from a member without DJ permission before connecting', async () => {
        const actor = {
            id: requesterId,
            voice: { channelId: null },
            permissions: { has: () => false },
            roles: { cache: new Map() },
        };
        const guild = {
            members: { fetch: jest.fn().mockResolvedValue(actor) },
            channels: { fetch: jest.fn() },
        };
        const client = {
            guilds: { fetch: jest.fn().mockResolvedValue(guild) },
        } as unknown as Client;
        await expect(
            new RadioRuntime().play(
                client,
                guildId,
                requesterId,
                'defcon',
                channelId
            )
        ).rejects.toThrow('could not start');
        expect(guild.channels.fetch).not.toHaveBeenCalled();
        expect(await db.voicePlayback.count({ where: { guildId } })).toBe(0);
    });
    it('checks a current DJ role before using a same-channel request', async () => {
        await moduleRegistry.configure(guildId, 'audio', true, {
            djRoles: ['777777777777777784'],
        });
        const actor = {
            id: requesterId,
            voice: { channelId },
            permissions: {
                has: (bit: bigint) => bit === PermissionFlagsBits.ViewChannel,
            },
            roles: { cache: new Map() },
        };
        const guild = {
            members: { fetch: jest.fn().mockResolvedValue(actor) },
            channels: { fetch: jest.fn() },
        };
        await expect(
            new RadioRuntime().play(
                {
                    guilds: { fetch: () => Promise.resolve(guild) },
                } as unknown as Client,
                guildId,
                requesterId,
                'defcon'
            )
        ).rejects.toThrow();
        expect(guild.channels.fetch).not.toHaveBeenCalled();
        expect(await db.voicePlayback.count({ where: { guildId } })).toBe(0);
    });
});
