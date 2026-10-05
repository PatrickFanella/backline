import {
    ChannelType,
    Client,
    PermissionFlagsBits,
    PermissionsBitField,
} from 'discord.js';

import {
    expirePollJobs,
    pollHandler,
    pollInput,
    queuePoll,
} from '../../../src/community/polls';
import { db } from '../../../src/db';
import { JobWorker } from '../../../src/jobs/store';
import { moduleRegistry } from '../../../src/modules/registry';
import { env } from '../../../src/utils/env';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('native channel polls', () => {
    const guildId = '777777777777777871',
        otherGuild = '777777777777777872',
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
    const end = jest.fn().mockResolvedValue({});
    const fetchMessage = jest.fn().mockResolvedValue({
        id: '777777777777777865',
        author: { id: 'bot' },
        poll: { expiresAt: new Date(Date.now() + 86400000), end },
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
    const input = () => ({
        channelId,
        action: 'create',
        question: 'Which day?',
        answers: ['Monday', 'Tuesday'],
        duration: 24,
        multiselect: false,
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
        await moduleRegistry.configure(guildId, 'polls', true, {});
    });
    afterEach(async () => {
        const where = { guildId: { in: [guildId, otherGuild] } };
        await db.jobAttempt.deleteMany({
            where: { job: { guildId: { in: [guildId, otherGuild] } } },
        });
        await db.durableJob.deleteMany({ where });
        await db.guildModuleConfig.deleteMany({ where });
        await db.guildInstallation.deleteMany({ where });
    });
    afterAll(async () => {
        env.BOT_GUILD_IDS.splice(0, env.BOT_GUILD_IDS.length, ...priorGuilds);
        await db.$disconnect();
    });
    it('validates distinct choices and native field limits', () => {
        const duplicates = {
            channelId,
            question: 'Pick',
            answers: ['same', ' SAME '],
            duration: 24,
            multiselect: false,
        };
        expect(pollInput.safeParse(duplicates).success).toBe(false);
        const { action, ...valid } = input();
        expect(action).toBe('create');
        expect(pollInput.safeParse(valid).success).toBe(true);
        expect(pollInput.safeParse({ ...valid, duration: 769 }).success).toBe(
            false
        );
        expect(pollInput.safeParse({ ...valid, answers: ['a'] }).success).toBe(
            false
        );
    });
    it('reserves one action for duplicate requests', async () => {
        const jobs = await Promise.all([
            queuePoll(client, guildId, actorId, 'same', input()),
            queuePoll(client, guildId, actorId, 'same', input()),
        ]);
        expect(jobs[0].id).toBe(jobs[1].id);
        expect(await db.durableJob.count({ where: { guildId } })).toBe(1);
        expect(send).not.toHaveBeenCalled();
    });
    it('uses competing worker leases to send exactly one native poll', async () => {
        const job = await queuePoll(client, guildId, actorId, 'send', input());
        await db.durableJob.update({
            where: { id: job.id },
            data: { runAt: new Date(Date.now() - 60000) },
        });
        const workers = [
            new JobWorker(new Map([['native-poll', pollHandler(client)]])),
            new JobWorker(new Map([['native-poll', pollHandler(client)]])),
        ];
        await Promise.all(workers.map((worker) => worker.tick()));
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith({
            allowedMentions: { parse: [], repliedUser: false },
            poll: {
                question: { text: 'Which day?' },
                answers: [{ text: 'Monday' }, { text: 'Tuesday' }],
                duration: 24,
                allowMultiselect: false,
            },
        });
        expect(
            (await db.durableJob.findFirstOrThrow({ where: { guildId } })).state
        ).toBe('DELIVERED');
    });
    it('holds a lost send without retrying a poll', async () => {
        const job = await queuePoll(
            client,
            guildId,
            actorId,
            'uncertain',
            input()
        );
        await db.durableJob.update({
            where: { id: job.id },
            data: { runAt: new Date(Date.now() - 60000) },
        });
        send.mockRejectedValue(new Error('Lost response'));
        const worker = new JobWorker(
            new Map([['native-poll', pollHandler(client)]])
        );
        await worker.tick();
        await worker.tick();
        expect(send).toHaveBeenCalledTimes(1);
        expect(await worker.reconcile(job.id, guildId)).toBe(false);
        expect(
            (await db.durableJob.findUniqueOrThrow({ where: { id: job.id } }))
                .state
        ).toBe('RECONCILE');
    });
    it('rejects nonmanagers, missing Send Polls and disabled delivery', async () => {
        actor.permissions = new PermissionsBitField();
        await expect(
            queuePoll(client, guildId, actorId, 'denied', input())
        ).rejects.toThrow('Manage Server');
        actor.permissions.add(PermissionFlagsBits.ManageGuild);
        permissions.remove(PermissionFlagsBits.SendPolls);
        await expect(
            queuePoll(client, guildId, actorId, 'denied', input())
        ).rejects.toThrow('permissions');
        permissions.add(PermissionFlagsBits.SendPolls);
        const job = await queuePoll(
            client,
            guildId,
            actorId,
            'disabled',
            input()
        );
        await moduleRegistry.configure(guildId, 'polls', false, {});
        await expect(pollHandler(client).execute(job)).rejects.toThrow(
            'disabled'
        );
        expect(send).not.toHaveBeenCalled();
    });
    it('cleans completed attempt receipts but preserves held sends', async () => {
        const job = await queuePoll(client, guildId, actorId, 'old', input());
        await db.durableJob.update({
            where: { id: job.id },
            data: { runAt: new Date(Date.now() - 60000) },
        });
        await new JobWorker(
            new Map([['native-poll', pollHandler(client)]])
        ).tick();
        await db.durableJob.update({
            where: { id: job.id },
            data: { createdAt: new Date(Date.now() - 33 * 86400000) },
        });
        const held = await queuePoll(client, guildId, actorId, 'held', input());
        await db.durableJob.update({
            where: { id: held.id },
            data: {
                state: 'RECONCILE',
                createdAt: new Date(Date.now() - 33 * 86400000),
            },
        });
        await expirePollJobs();
        expect(
            await db.durableJob.findUnique({ where: { id: job.id } })
        ).toBeNull();
        expect(await db.jobAttempt.count({ where: { jobId: job.id } })).toBe(0);
        expect(
            await db.durableJob.findUnique({ where: { id: held.id } })
        ).not.toBeNull();
    });
    it('ends only a bot-owned native poll and holds unconfirmed closure', async () => {
        const job = await queuePoll(client, guildId, actorId, 'close', {
            action: 'close',
            channelId,
            messageId: '777777777777777865',
        });
        expect((await pollHandler(client).execute(job)).state).toBe(
            'DELIVERED'
        );
        expect(end).toHaveBeenCalledTimes(1);
        expect((await pollHandler(client).reconcile(job)).state).toBe(
            'RECONCILE'
        );
        fetchMessage.mockResolvedValueOnce({
            id: '777777777777777865',
            author: { id: 'someone-else' },
            poll: { end },
        });
        await expect(
            queuePoll(client, guildId, actorId, 'foreign', {
                action: 'close',
                channelId,
                messageId: '777777777777777865',
            })
        ).rejects.toThrow('unavailable');
    });
});
