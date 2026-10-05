import {
    ChannelType,
    Client,
    Message,
    PermissionFlagsBits,
    PermissionsBitField,
    Collection,
} from 'discord.js';

import {
    localCalendar,
    maintainMemberUtilities,
    memberNoticeHandler,
    observeAfkMessage,
    queueBirthdays,
    removeBirthday,
    setAfk,
    setBirthday,
} from '../../../src/community/memberUtilities';
import { db } from '../../../src/db';
import { JobWorker } from '../../../src/jobs/store';
import { moduleRegistry } from '../../../src/modules/registry';
import { env } from '../../../src/utils/env';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('AFK and birthday sharing', () => {
    const guildId = '777777777777777891',
        otherGuild = '777777777777777892',
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
        PermissionFlagsBits.SendPolls,
        PermissionFlagsBits.ReadMessageHistory,
    ]);
    const send = jest.fn().mockResolvedValue({ id: '777777777777777865' });

    const fetchMessage = jest.fn().mockResolvedValue({
        id: '777777777777777865',
        author: { id: 'bot' },
    });
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
    let priorMessages: boolean, priorMembers: boolean;
    beforeAll(() => {
        priorGuilds = [...env.BOT_GUILD_IDS];
        priorMessages = env.BOT_MESSAGE_INTENTS;
        priorMembers = env.BOT_MEMBER_INTENTS;
        env.BOT_MESSAGE_INTENTS = true;
        env.BOT_MEMBER_INTENTS = true;
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
        Object.assign(actor, {
            guild: await client.guilds.fetch(guildId),
            displayName: 'Fixture member',
        });
        fetchMessage.mockClear();
        for (const id of [guildId, otherGuild])
            await db.guildInstallation.create({
                data: { guildId: id, name: 'Schedule fixture', active: true },
            });
        await moduleRegistry.configure(guildId, 'afk', true, {});
        await moduleRegistry.configure(guildId, 'birthdays', true, {
            channelId,
            timeZone: 'UTC',
            hour: 0,
        });
    });
    afterEach(async () => {
        const where = { guildId: { in: [guildId, otherGuild] } };
        await db.jobAttempt.deleteMany({
            where: { job: { guildId: { in: [guildId, otherGuild] } } },
        });
        await db.durableJob.deleteMany({ where });
        await db.memberAfk.deleteMany({ where });
        await db.memberBirthday.deleteMany({ where });
        await db.guildModuleConfig.deleteMany({ where });
        await db.guildInstallation.deleteMany({ where });
    });
    afterAll(async () => {
        env.BOT_GUILD_IDS.splice(0, env.BOT_GUILD_IDS.length, ...priorGuilds);
        env.BOT_MESSAGE_INTENTS = priorMessages;
        env.BOT_MEMBER_INTENTS = priorMembers;
        await db.$disconnect();
    });
    const otherMember = '777777777777777899';
    function message(author: string, mentions: string[] = []) {
        return {
            id: '777777777777777898',
            guildId,
            channelId,
            createdAt: new Date(Date.now() + 1000),
            author: { id: author, bot: false },
            webhookId: null,
            client,
            mentions: {
                users: new Collection(
                    mentions.map((id) => [id, { id, bot: false }])
                ),
            },
        } as unknown as Message;
    }
    async function work(kind: string) {
        await db.durableJob.updateMany({
            where: { guildId },
            data: { runAt: new Date(Date.now() - 60000) },
        });
        return new JobWorker(
            new Map([[kind, memberNoticeHandler(client)]])
        ).tick();
    }
    it('clears AFK on speech and keeps duplicate messages from reserving extra notices', async () => {
        await setAfk(client, guildId, otherMember, 'At lunch', 1);
        await Promise.all([
            observeAfkMessage(message(actorId, [otherMember])),
            observeAfkMessage(message(actorId, [otherMember])),
        ]);
        expect(await db.durableJob.count({ where: { guildId } })).toBe(1);
        await work('afk-notice');
        expect(send.mock.calls[0][0].content).toContain('At lunch');
        expect(send.mock.calls[0][0].allowedMentions).toEqual({
            parse: [],
            users: [],
        });
        await observeAfkMessage(message(otherMember));
        expect(await db.memberAfk.count({ where: { guildId } })).toBe(0);
    });
    it('does not clear a newer status from a delayed older message', async () => {
        const row = await setAfk(client, guildId, actorId, 'Away');
        const delayed = message(actorId);
        Object.assign(delayed, {
            createdAt: new Date(row.setAt.getTime() - 1000),
        });
        await observeAfkMessage(delayed);
        expect(await db.memberAfk.count({ where: { guildId } })).toBe(1);
    });
    it('expires reasons and preserves other-server status', async () => {
        await setAfk(client, guildId, actorId, 'Away');
        await db.memberAfk.updateMany({
            where: { guildId },
            data: { expiresAt: new Date(Date.now() - 1000) },
        });
        await db.memberAfk.create({
            data: {
                guildId: otherGuild,
                memberId: actorId,
                reason: 'Away',
                expiresAt: new Date(Date.now() + 60000),
            },
        });
        await maintainMemberUtilities();
        expect(await db.memberAfk.count({ where: { guildId } })).toBe(0);
        expect(
            await db.memberAfk.count({ where: { guildId: otherGuild } })
        ).toBe(1);
    });
    it('requires consent and a valid month/day without collecting a year', async () => {
        await expect(
            setBirthday(client, guildId, actorId, {
                month: 2,
                day: 30,
                share: true,
            })
        ).rejects.toThrow();
        await expect(
            setBirthday(client, guildId, actorId, {
                month: 2,
                day: 29,
                share: false,
            })
        ).rejects.toThrow();
        const row = await setBirthday(client, guildId, actorId, {
            month: 2,
            day: 29,
            share: true,
        });
        expect(row.month).toBe(2);
        expect(row).not.toHaveProperty('year');
    });
    it('reserves one annual greeting through competing scheduler passes and delivers with current consent', async () => {
        const now = new Date(),
            calendar = localCalendar(now, 'UTC');
        await setBirthday(client, guildId, actorId, {
            month: calendar.month,
            day: calendar.day,
            share: true,
        });
        await Promise.all([queueBirthdays(now), queueBirthdays(now)]);
        expect(
            await db.durableJob.count({
                where: { guildId, kind: 'birthday-notice' },
            })
        ).toBe(1);
        await work('birthday-notice');
        expect(send.mock.calls[0][0].content).toContain('Happy birthday');
        await queueBirthdays(now);
        expect(await db.durableJob.count({ where: { guildId } })).toBe(1);
    });
    it('withdraws consent by deleting the profile and cancelling queued greetings', async () => {
        const calendar = localCalendar(new Date(), 'UTC');
        await setBirthday(client, guildId, actorId, {
            month: calendar.month,
            day: calendar.day,
            share: true,
        });
        await queueBirthdays();
        await removeBirthday(guildId, actorId);
        expect(await db.memberBirthday.count({ where: { guildId } })).toBe(0);
        expect(
            (await db.durableJob.findFirstOrThrow({ where: { guildId } })).state
        ).toBe('CANCELLED');
        await work('birthday-notice');
        expect(send).not.toHaveBeenCalled();
    });
});
