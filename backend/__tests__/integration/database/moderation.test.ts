import { Client, Collection } from 'discord.js';

import { db } from '../../../src/db';
import {
    moderationInput,
    performModeration,
} from '../../../src/moderation/service';
import { moduleRegistry } from '../../../src/modules/registry';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('moderation delivery and case persistence', () => {
    const guildId = '111111111111111111';
    const targetId = '123456789012345678';
    const actor = {
        id: 'actor',
        permissions: { has: jest.fn(() => true) },
        roles: { highest: { comparePositionTo: jest.fn(() => 1) } },
    };
    const bot = {
        id: 'bot',
        permissions: { has: jest.fn(() => true) },
        roles: { highest: { comparePositionTo: jest.fn(() => 1) } },
    };
    const target = {
        id: targetId,
        roles: { highest: {} },
        permissions: { has: () => false },
        kick: jest.fn(),
        ban: jest.fn(),
        timeout: jest.fn(),
    };
    const channel = {
        isTextBased: () => true,
        permissionsFor: jest.fn(() => ({ has: () => true })),
        messages: { fetch: jest.fn() },
        bulkDelete: jest.fn(),
    };
    const guild = {
        ownerId: 'owner',
        members: { fetch: jest.fn(), fetchMe: jest.fn(), unban: jest.fn() },
        channels: { fetch: jest.fn() },
        bans: { fetch: jest.fn() },
    };
    const client = { guilds: { fetch: jest.fn() } };
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(moduleRegistry, 'enabled').mockResolvedValue(true);
        client.guilds.fetch.mockResolvedValue(guild);
        guild.members.fetch.mockImplementation(({ user }: { user: string }) =>
            Promise.resolve(user === 'actor' ? actor : target)
        );
        guild.members.fetchMe.mockResolvedValue(bot);
        actor.permissions.has.mockReturnValue(true);
        bot.permissions.has.mockReturnValue(true);
        actor.roles.highest.comparePositionTo.mockReturnValue(1);
        bot.roles.highest.comparePositionTo.mockReturnValue(1);
        target.kick.mockResolvedValue(target);
        guild.channels.fetch.mockResolvedValue(channel);
    });
    afterEach(async () => {
        jest.restoreAllMocks();
        await db.moderationCase.deleteMany({ where: { guildId } });
    });
    afterAll(async () => {
        await db.$disconnect();
    });
    const kick = (requestId = 'request') =>
        performModeration(
            client as unknown as Client,
            guildId,
            'actor',
            requestId,
            { action: 'kick', targetId, reason: 'fixture' }
        );
    it('executes only once under concurrent identical requests and survives caller replay', async () => {
        const records = await Promise.all(
            Array.from({ length: 5 }, () => kick())
        );
        expect(new Set(records.map((record) => record.id)).size).toBe(1);
        expect(target.kick).toHaveBeenCalledTimes(1);
        expect((await kick()).state).toBe('DELIVERED');
        expect(target.kick).toHaveBeenCalledTimes(1);
    });
    it.each(['actor', 'bot'])(
        'denies revoked %s permissions before mutation',
        async (who) => {
            (who === 'actor' ? actor : bot).permissions.has.mockReturnValue(
                false
            );
            expect((await kick()).state).toBe('DENIED');
            expect(target.kick).not.toHaveBeenCalled();
        }
    );
    it.each(['actor', 'bot'])(
        'denies an equal or higher target relative to %s',
        async (who) => {
            (who === 'actor'
                ? actor
                : bot
            ).roles.highest.comparePositionTo.mockReturnValue(0);
            expect((await kick()).state).toBe('DENIED');
            expect(target.kick).not.toHaveBeenCalled();
        }
    );
    it('holds a lost Discord response and never retries the mutation', async () => {
        target.kick.mockRejectedValue(new Error('lost private response'));
        expect((await kick()).state).toBe('UNCERTAIN');
        expect((await kick()).state).toBe('UNCERTAIN');
        expect(target.kick).toHaveBeenCalledTimes(1);
    });
    it('skips pinned and old messages and records actual deleted IDs', async () => {
        channel.messages.fetch.mockResolvedValue(
            new Collection([
                ['new', { pinned: false, createdTimestamp: Date.now() }],
                ['pinned', { pinned: true, createdTimestamp: Date.now() }],
                ['old', { pinned: false, createdTimestamp: 0 }],
            ])
        );
        channel.bulkDelete.mockImplementation(
            (messages: Collection<string, unknown>) => Promise.resolve(messages)
        );
        const record = await performModeration(
            client as unknown as Client,
            guildId,
            'actor',
            'purge',
            {
                action: 'purge',
                channelId: targetId,
                count: 3,
                reason: 'fixture',
            }
        );
        expect(record.outcome).toEqual({
            deletedIds: ['new'],
            deletedCount: 1,
            requested: 3,
            skipped: 2,
        });
    });
    it('does not unban based on a cached ban that is absent from Discord', async () => {
        guild.bans.fetch.mockImplementation((options: { force?: boolean }) => {
            if (options.force)
                return Promise.reject(new Error('Current ban absent'));
            return Promise.resolve({ user: { id: targetId } });
        });
        const record = await performModeration(
            client as unknown as Client,
            guildId,
            'actor',
            'stale-ban',
            {
                action: 'unban',
                targetId,
                reason: 'fixture',
            }
        );
        expect(record.state).toBe('FAILED');
        expect(guild.members.unban).not.toHaveBeenCalled();
    });
    it('unbans after verifying the current ban and does not replay a delivered action', async () => {
        guild.bans.fetch.mockResolvedValue({ user: { id: targetId } });
        guild.members.unban.mockResolvedValue(targetId);
        const run = () =>
            performModeration(
                client as unknown as Client,
                guildId,
                'actor',
                'current-ban',
                {
                    action: 'unban',
                    targetId,
                    reason: 'fixture',
                }
            );
        expect((await run()).state).toBe('DELIVERED');
        expect((await run()).state).toBe('DELIVERED');
        expect(guild.members.unban).toHaveBeenCalledTimes(1);
    });
    it('bounds destructive inputs', () => {
        expect(
            moderationInput.safeParse({
                action: 'timeout',
                targetId,
                minutes: 40321,
                reason: 'fixture',
            }).success
        ).toBe(false);
        expect(
            moderationInput.safeParse({
                action: 'purge',
                channelId: targetId,
                count: 101,
                reason: 'fixture',
            }).success
        ).toBe(false);
    });
});
