import {
    ChannelType,
    Client,
    PermissionFlagsBits,
    PermissionsBitField,
} from 'discord.js';

import { db } from '../../../src/db';
import { JobWorker } from '../../../src/jobs/store';
import { moduleRegistry } from '../../../src/modules/registry';
import { env } from '../../../src/utils/env';
import {
    triggerWorkflow,
    workflowMessageHandler,
} from '../../../src/workflows/engine';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('community workflows', () => {
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
    const rule = {
        id: 'manual-test',
        trigger: 'manual',
        channelId,
        message: 'Hello {title}',
        provider: 'any',
        contains: '',
        requiredRole: null,
        cooldownSeconds: 60,
    };
    const event = (eventId = 'fixture') => ({
        guildId,
        eventId,
        trigger: 'manual' as const,
        at: new Date(),
        title: '@everyone',
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
            'workflows',
            true,
            { rules: [rule] },
            actorId
        );
    });
    afterEach(async () => {
        const where = { guildId: { in: [guildId, otherGuild] } };
        await db.jobAttempt.deleteMany({
            where: { job: { guildId: { in: [guildId, otherGuild] } } },
        });
        await db.durableJob.deleteMany({ where });
        await db.workflowRun.deleteMany({ where });
        await db.guildModuleConfig.deleteMany({ where });
        await db.guildInstallation.deleteMany({ where });
    });
    afterAll(async () => {
        env.BOT_GUILD_IDS.splice(0, env.BOT_GUILD_IDS.length, ...priorGuilds);
        await db.$disconnect();
    });
    it('reserves one run and action for concurrent duplicate triggers', async () => {
        const runs = await Promise.all([
            triggerWorkflow(event()),
            triggerWorkflow(event()),
        ]);
        expect(runs[0][0].id).toBe(runs[1][0].id);
        expect(await db.durableJob.count({ where: { guildId } })).toBe(1);
    });
    it('enforces cooldown with a persisted skipped receipt', async () => {
        await triggerWorkflow(event());
        const skipped = await triggerWorkflow(event('second'));
        expect(skipped[0].state).toBe('SKIPPED');
        expect((await triggerWorkflow(event('second')))[0].id).toBe(
            skipped[0].id
        );
        expect(await db.durableJob.count({ where: { guildId } })).toBe(1);
    });
    it('sends once and reads a recreated handler receipt', async () => {
        await triggerWorkflow(event());
        const job = await db.durableJob.findFirstOrThrow({
                where: { guildId },
            }),
            handler = workflowMessageHandler(client);
        expect(await handler.authorize(job)).toBe(true);
        await Promise.all([handler.execute(job), handler.execute(job)]);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0].allowedMentions.parse).toEqual([]);
        expect(send.mock.calls[0][0].content).toBe('Hello ＠everyone');
        expect(
            (await workflowMessageHandler(client).reconcile(job)).state
        ).toBe('DELIVERED');
    });
    it('invalidates queued actions when the rule changes', async () => {
        await triggerWorkflow(event());
        const job = await db.durableJob.findFirstOrThrow({
            where: { guildId },
        });
        await moduleRegistry.configure(
            guildId,
            'workflows',
            true,
            { rules: [{ ...rule, message: 'Changed' }] },
            actorId
        );
        expect(await workflowMessageHandler(client).authorize(job)).toBe(false);
        expect((await workflowMessageHandler(client).execute(job)).state).toBe(
            'CANCELLED'
        );
        expect(send).not.toHaveBeenCalled();
    });
    it('holds uncertain sends', async () => {
        await triggerWorkflow(event());
        const job = await db.durableJob.findFirstOrThrow({
                where: { guildId },
            }),
            handler = workflowMessageHandler(client);
        send.mockRejectedValue(new Error('lost outcome'));
        expect((await handler.execute(job)).state).toBe('RECONCILE');
        expect((await handler.execute(job)).state).toBe('RECONCILE');
        expect(send).toHaveBeenCalledTimes(1);
    });
    it('filters provider and title conditions and ignores old triggers', async () => {
        await moduleRegistry.configure(
            guildId,
            'workflows',
            true,
            {
                rules: [
                    {
                        ...rule,
                        trigger: 'provider_event',
                        provider: 'twitch',
                        contains: 'music',
                    },
                ],
            },
            actorId
        );
        expect(
            await triggerWorkflow({
                ...event(),
                trigger: 'provider_event',
                provider: 'youtube',
                title: 'Music',
            })
        ).toEqual([]);
        expect(
            await triggerWorkflow({
                ...event(),
                trigger: 'provider_event',
                provider: 'twitch',
                title: 'Other',
            })
        ).toEqual([]);
        expect(
            await triggerWorkflow({
                ...event(),
                trigger: 'provider_event',
                provider: 'twitch',
                title: 'Music',
            })
        ).toHaveLength(1);
        expect(
            await triggerWorkflow({
                ...event('old'),
                at: new Date(Date.now() - 3600000),
            })
        ).toEqual([]);
    });
    it('attributes configuration to the manager and blocks disabled/cross-server work', async () => {
        await moduleRegistry.configure(
            guildId,
            'workflows',
            true,
            { rules: [{ ...rule, actorId: otherGuild }] },
            actorId
        );
        const row = await triggerWorkflow(event());
        expect(row[0].actorId).toBe(actorId);
        expect(
            await triggerWorkflow({ ...event(), guildId: otherGuild })
        ).toEqual([]);
        await moduleRegistry.configure(
            guildId,
            'workflows',
            false,
            { rules: [rule] },
            actorId
        );
        expect(await triggerWorkflow(event('disabled'))).toEqual([]);
    });
    it('runs through the actual durable worker and records delivery history', async () => {
        await triggerWorkflow(event());
        await db.durableJob.updateMany({
            where: { guildId },
            data: { runAt: new Date(Date.now() - 60000) },
        });
        const worker = new JobWorker(
            new Map([['workflow-message', workflowMessageHandler(client)]])
        );
        await Promise.all([worker.tick(), worker.tick()]);
        expect(
            (await db.durableJob.findFirstOrThrow({ where: { guildId } })).state
        ).toBe('DELIVERED');
        expect(await db.jobAttempt.count({ where: { job: { guildId } } })).toBe(
            1
        );
        expect(send).toHaveBeenCalledTimes(1);
    });
    it('enforces the rolling daily action limit', async () => {
        await db.workflowRun.createMany({
            data: Array.from({ length: 50 }, (_row, index) => ({
                guildId,
                ruleId: rule.id,
                eventId: 'limit:' + index,
                actorId,
                fingerprint: 'fixture',
                channelId,
                content: '',
                state: 'DELIVERED',
                createdAt: new Date(Date.now() - 3600000),
            })),
        });
        expect((await triggerWorkflow(event()))[0].state).toBe('SKIPPED');
        expect(await db.durableJob.count({ where: { guildId } })).toBe(0);
    });
});
