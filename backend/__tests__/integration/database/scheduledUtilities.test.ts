import {
    ChannelType,
    Client,
    PermissionFlagsBits,
    PermissionsBitField,
} from 'discord.js';

import {
    cancelUtility,
    expireScheduledUtilities,
    scheduleUtility,
    scheduledUtilityHandler,
} from '../../../src/community/scheduledUtilities';
import { db } from '../../../src/db';
import { JobWorker } from '../../../src/jobs/store';
import { moduleRegistry } from '../../../src/modules/registry';
import { env } from '../../../src/utils/env';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('durable channel utilities', () => {
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
    const input = () => ({
        kind: 'ANNOUNCEMENT',
        channelId,
        content: 'Hello @everyone',
        timeZone: 'UTC',
        local: new Date(Date.now() + 3600000).toISOString().slice(0, 16),
    });
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
        await moduleRegistry.configure(
            guildId,
            'scheduled-utilities',
            true,
            {}
        );
    });
    afterEach(async () => {
        const where = { guildId: { in: [guildId, otherGuild] } };
        await db.jobAttempt.deleteMany({
            where: { job: { guildId: { in: [guildId, otherGuild] } } },
        });
        await db.durableJob.deleteMany({ where });
        await db.scheduledUtility.deleteMany({ where });
        await db.guildModuleConfig.deleteMany({ where });
        await db.guildInstallation.deleteMany({ where });
    });
    afterAll(async () => {
        env.BOT_GUILD_IDS.splice(0, env.BOT_GUILD_IDS.length, ...priorGuilds);
        await db.$disconnect();
    });
    async function due() {
        const event = await scheduleUtility(
            client,
            guildId,
            actorId,
            'fixture',
            input()
        );
        await db.scheduledUtility.update({
            where: { id: event.id },
            data: { runAt: new Date(Date.now() - 1000) },
        });
        const job = await db.durableJob.findUniqueOrThrow({
            where: {
                guildId_idempotencyKey: {
                    guildId,
                    idempotencyKey: 'scheduled-utility:' + event.id,
                },
            },
        });
        return { event, job, handler: scheduledUtilityHandler(client) };
    }
    it('reserves one event and job under concurrent duplicate requests', async () => {
        const results = await Promise.all([
            scheduleUtility(client, guildId, actorId, 'same', input()),
            scheduleUtility(client, guildId, actorId, 'same', input()),
        ]);
        expect(results[0].id).toBe(results[1].id);
        expect(await db.durableJob.count({ where: { guildId } })).toBe(1);
        expect(send).not.toHaveBeenCalled();
    });
    it('delivers only once across concurrent executions and reads back the recorded receipt', async () => {
        const { event, job, handler } = await due();
        expect(await handler.authorize(job)).toBe(true);
        const results = await Promise.all([
            handler.execute(job),
            handler.execute(job),
        ]);
        expect(results.map((result) => result.state)).toEqual([
            'DELIVERED',
            'DELIVERED',
        ]);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith({
            content: 'Hello @everyone',
            allowedMentions: { parse: [], users: [], repliedUser: false },
        });
        const recreated = scheduledUtilityHandler(client);
        expect((await recreated.reconcile(job)).state).toBe('DELIVERED');
        expect(fetchMessage).toHaveBeenCalledWith({
            message: '777777777777777865',
            force: true,
        });
        expect(
            (
                await db.scheduledUtility.findUniqueOrThrow({
                    where: { id: event.id },
                })
            ).state
        ).toBe('DELIVERED');
    });
    it('holds a failed or lost Discord send without replaying it', async () => {
        const { event, job, handler } = await due();
        send.mockRejectedValue(new Error('Lost response'));
        expect((await handler.execute(job)).state).toBe('RECONCILE');
        expect((await handler.execute(job)).state).toBe('RECONCILE');
        expect((await handler.reconcile(job)).state).toBe('RECONCILE');
        expect(send).toHaveBeenCalledTimes(1);
        expect(
            (
                await db.scheduledUtility.findUniqueOrThrow({
                    where: { id: event.id },
                })
            ).state
        ).toBe('UNCERTAIN');
    });
    it('rechecks member permissions and opt-in state immediately before delivery', async () => {
        const { job, handler } = await due();
        actor.permissions = new PermissionsBitField();
        await expect(handler.execute(job)).rejects.toThrow('Manage Server');
        actor.permissions.add(PermissionFlagsBits.ManageGuild);
        permissions.remove(PermissionFlagsBits.SendMessages);
        await expect(handler.execute(job)).rejects.toThrow('Bot cannot send');
        permissions.add(PermissionFlagsBits.SendMessages);
        await moduleRegistry.configure(
            guildId,
            'scheduled-utilities',
            false,
            {}
        );
        await expect(handler.execute(job)).rejects.toThrow('disabled');
        expect(send).not.toHaveBeenCalled();
    });
    it('cancels only pending events in the same server and wipes their message content', async () => {
        const { event, job, handler } = await due();
        await expect(
            cancelUtility(client, otherGuild, actorId, event.id)
        ).rejects.toThrow('unavailable');
        await cancelUtility(client, guildId, actorId, event.id);
        expect(await handler.authorize(job)).toBe(false);
        expect(
            (
                await db.scheduledUtility.findUniqueOrThrow({
                    where: { id: event.id },
                })
            ).content
        ).toBe('');
        expect(
            (await db.durableJob.findUniqueOrThrow({ where: { id: job.id } }))
                .state
        ).toBe('CANCELLED');
        expect(send).not.toHaveBeenCalled();
    });
    it('allows a reminder to notify only its current requesting member', async () => {
        actor.permissions = new PermissionsBitField();
        const event = await scheduleUtility(
            client,
            guildId,
            actorId,
            'reminder',
            { ...input(), kind: 'REMINDER' }
        );
        await db.scheduledUtility.update({
            where: { id: event.id },
            data: { runAt: new Date(Date.now() - 1000) },
        });
        const job = await db.durableJob.findFirstOrThrow({
            where: { guildId },
        });
        expect((await scheduledUtilityHandler(client).execute(job)).state).toBe(
            'DELIVERED'
        );
        expect(send).toHaveBeenCalledWith({
            content: `<@${actorId}> Reminder: Hello @everyone`,
            allowedMentions: {
                parse: [],
                users: [actorId],
                repliedUser: false,
            },
        });
    });
    it('rejects out-of-window schedules and nonexistent local times before storing an event', async () => {
        await expect(
            scheduleUtility(client, guildId, actorId, 'past', {
                ...input(),
                local: '2020-01-01T00:00',
            })
        ).rejects.toThrow('future');
        await expect(
            scheduleUtility(client, guildId, actorId, 'gap', {
                ...input(),
                local: '2026-03-08T02:30',
                timeZone: 'America/New_York',
            })
        ).rejects.toThrow('does not exist');
        expect(await db.scheduledUtility.count({ where: { guildId } })).toBe(0);
    });
    it('removes completed worker attempts together with expired schedule receipts', async () => {
        const { event, job, handler } = await due();
        await db.durableJob.update({
            where: { id: job.id },
            data: { runAt: new Date(Date.now() - 1000) },
        });
        await new JobWorker(new Map([['scheduled-utility', handler]])).tick();
        expect(await db.jobAttempt.count({ where: { jobId: job.id } })).toBe(1);
        await db.scheduledUtility.update({
            where: { id: event.id },
            data: { expiresAt: new Date(Date.now() - 32 * 86400000) },
        });
        await expireScheduledUtilities();
        expect(await db.jobAttempt.count({ where: { jobId: job.id } })).toBe(0);
        expect(
            await db.durableJob.findUnique({ where: { id: job.id } })
        ).toBeNull();
    });
    it('expires old content and its job together without deleting another guild', async () => {
        const { event } = await due();
        await db.scheduledUtility.update({
            where: { id: event.id },
            data: { expiresAt: new Date(Date.now() - 32 * 86400000) },
        });
        await expireScheduledUtilities();
        expect(await db.scheduledUtility.count({ where: { guildId } })).toBe(0);
        expect(await db.durableJob.count({ where: { guildId } })).toBe(0);
        expect(
            await db.guildInstallation.count({ where: { guildId: otherGuild } })
        ).toBe(1);
    });
});
