import { createHash } from 'node:crypto';

import {
    ChannelType,
    Client,
    PermissionFlagsBits,
    PermissionsBitField,
} from 'discord.js';

import { db } from '../../../src/db';
import {
    addFeed,
    recordProviderItems,
    maintainProviderFeeds,
    removeFeed,
    providerNotificationHandler,
} from '../../../src/integrations/notifications';
import { moduleRegistry } from '../../../src/modules/registry';
import { env } from '../../../src/utils/env';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('provider notifications', () => {
    const guildId = '777777777777777861',
        otherGuild = '777777777777777862',
        actorId = '777777777777777863',
        channelId = '777777777777777864';
    const actor = {
        id: actorId,
        user: { bot: false },
        permissions: new PermissionsBitField([PermissionFlagsBits.ManageGuild]),
    };
    const permissions = new PermissionsBitField([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
    ]);
    const send = jest.fn().mockResolvedValue({ id: '777777777777777865' });
    const fetchMessage = jest
        .fn()
        .mockResolvedValue({ id: '777777777777777865', author: { id: 'bot' } });
    const channel = {
        id: channelId,
        type: ChannelType.GuildText,
        permissionsFor: () => permissions,
        send,
        messages: { fetch: fetchMessage },
    };
    const client = {
        user: { id: 'bot' },
        guilds: {
            fetch: jest.fn().mockResolvedValue({
                id: guildId,
                members: {
                    fetch: jest.fn().mockResolvedValue(actor),
                    fetchMe: jest.fn().mockResolvedValue({ id: 'bot' }),
                },
                channels: { fetch: jest.fn().mockResolvedValue(channel) },
            }),
        },
    } as unknown as Client;
    let priorGuilds: string[];
    beforeAll(() => {
        priorGuilds = [...env.BOT_GUILD_IDS];
        env.BOT_GUILD_IDS.push(guildId, otherGuild);
    });
    beforeEach(async () => {
        actor.permissions = new PermissionsBitField([
            PermissionFlagsBits.ManageGuild,
        ]);
        permissions.add(
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages
        );
        send.mockReset().mockResolvedValue({ id: '777777777777777865' });
        fetchMessage.mockClear();
        for (const id of [guildId, otherGuild])
            await db.guildInstallation.create({
                data: { guildId: id, name: 'Schedule fixture', active: true },
            });
        await moduleRegistry.configure(guildId, 'integrations', true, {});
    });
    afterEach(async () => {
        const where = { guildId: { in: [guildId, otherGuild] } };
        await db.jobAttempt.deleteMany({
            where: { job: { guildId: { in: [guildId, otherGuild] } } },
        });
        await db.durableJob.deleteMany({ where });
        await db.providerEvent.deleteMany({ where });
        await db.providerFeed.deleteMany({ where });
        await db.guildModuleConfig.deleteMany({ where });
        await db.guildInstallation.deleteMany({ where });
    });
    afterAll(async () => {
        env.BOT_GUILD_IDS.splice(0, env.BOT_GUILD_IDS.length, ...priorGuilds);
        await db.$disconnect();
    });
    const item = (id: string, date: Date) => ({
        id: createHash('sha256').update(id).digest('hex'),
        title: 'New item @everyone',
        url: 'https://www.twitch.tv/subcult',
        publishedAt: date,
    });
    const source = {
        channelId,
        subscription: { provider: 'twitch', source: 'subcult' },
    };
    async function baseline() {
        const feed = await addFeed(client, guildId, actorId, source);
        const now = new Date();
        await recordProviderItems(
            feed,
            [item('old', new Date(now.getTime() - 3600000))],
            now
        );
        return { feed, now };
    }
    it('records a first-poll baseline without replaying older items', async () => {
        await baseline();
        expect(await db.durableJob.count({ where: { guildId } })).toBe(0);
        expect(
            (await db.providerEvent.findFirstOrThrow({ where: { guildId } }))
                .state
        ).toBe('BASELINE');
    });
    it('reserves a new provider event once across concurrent and restarted polls', async () => {
        const { feed, now } = await baseline();
        const next = new Date(now.getTime() + 1000),
            items = [item('new', next)];
        await Promise.all([
            recordProviderItems(feed, items, next),
            recordProviderItems(feed, items, next),
        ]);
        await recordProviderItems(feed, items, next);
        expect(await db.durableJob.count({ where: { guildId } })).toBe(1);
    });
    it('sends once and verifies a persisted receipt with a recreated handler', async () => {
        const { feed, now } = await baseline();
        const next = new Date(now.getTime() + 1000);
        await recordProviderItems(feed, [item('new', next)], next);
        const job = await db.durableJob.findFirstOrThrow({
                where: { guildId },
            }),
            handler = providerNotificationHandler(client);
        expect(await handler.authorize(job)).toBe(true);
        await Promise.all([handler.execute(job), handler.execute(job)]);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0].allowedMentions.parse).toEqual([]);
        expect(
            (await providerNotificationHandler(client).reconcile(job)).state
        ).toBe('DELIVERED');
    });
    it('holds a lost-send result instead of resending', async () => {
        const { feed, now } = await baseline();
        const next = new Date(now.getTime() + 1000);
        await recordProviderItems(feed, [item('new', next)], next);
        send.mockRejectedValue(new Error('lost result'));
        const job = await db.durableJob.findFirstOrThrow({
                where: { guildId },
            }),
            handler = providerNotificationHandler(client);
        expect((await handler.execute(job)).state).toBe('RECONCILE');
        expect((await handler.execute(job)).state).toBe('RECONCILE');
        expect(send).toHaveBeenCalledTimes(1);
    });
    it('cancels queued events when a feed is removed', async () => {
        const { feed, now } = await baseline();
        const next = new Date(now.getTime() + 1000);
        await recordProviderItems(feed, [item('new', next)], next);
        await removeFeed(client, guildId, actorId, feed.id);
        expect(
            (await db.durableJob.findFirstOrThrow({ where: { guildId } })).state
        ).toBe('CANCELLED');
        expect(
            (
                await db.providerFeed.findUniqueOrThrow({
                    where: { id: feed.id },
                })
            ).enabled
        ).toBe(false);
    });
    it('retries an outage with increasing backoff and preserves baseline', async () => {
        const { feed } = await baseline();
        const adapter = jest
            .fn()
            .mockRejectedValue(new Error('secret should not persist'));
        let now = new Date(Date.now() + 1000000);
        await maintainProviderFeeds(adapter, now);
        const failed = await db.providerFeed.findUniqueOrThrow({
            where: { id: feed.id },
        });
        expect(failed.failures).toBe(1);
        expect(failed.baselineAt).not.toBeNull();
        expect(failed.lastError).not.toContain('secret');
        now = new Date(failed.nextPollAt.getTime() + 1);
        await maintainProviderFeeds(adapter, now);
        const second = await db.providerFeed.findUniqueOrThrow({
            where: { id: feed.id },
        });
        expect(second.nextPollAt.getTime() - now.getTime()).toBe(240000);
    });
    it('enforces current manager authority and server boundaries', async () => {
        const { feed } = await baseline();
        await expect(
            removeFeed(client, otherGuild, actorId, feed.id)
        ).rejects.toThrow();
        actor.permissions = new PermissionsBitField([]);
        await expect(
            addFeed(client, guildId, actorId, {
                channelId,
                subscription: { provider: 'twitch', source: 'another' },
            })
        ).rejects.toThrow();
    });
});
