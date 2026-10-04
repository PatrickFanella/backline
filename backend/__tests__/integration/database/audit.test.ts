import { Client } from 'discord.js';

import {
    auditHandler,
    expireAuditContent,
    recordAudit,
    recoverAuditEvents,
} from '../../../src/community/audit';
import { db } from '../../../src/db';
import { moduleRegistry } from '../../../src/modules/registry';
import { env } from '../../../src/utils/env';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('server audit retention and delivery', () => {
    const guildId = '222222222222222222';
    const destination = '333333333333333333';
    const client = { guilds: { fetch: jest.fn() } };
    const channel = { isTextBased: () => true, send: jest.fn() };
    const guild = { channels: { fetch: jest.fn() } };
    beforeEach(async () => {
        env.BOT_GUILD_IDS.push(guildId);
        env.BOT_MEMBER_INTENTS = true;
        env.BOT_MESSAGE_INTENTS = true;
        await db.guildInstallation.upsert({
            where: { guildId },
            create: { guildId, name: 'fixture', active: true },
            update: { active: true },
        });
        await moduleRegistry.configure(guildId, 'audit-log', true, {
            channelId: destination,
        });
        client.guilds.fetch.mockResolvedValue(guild);
        guild.channels.fetch.mockResolvedValue(channel);
        channel.send.mockResolvedValue({ id: 'provider-id' });
    });
    afterEach(async () => {
        env.BOT_GUILD_IDS.splice(env.BOT_GUILD_IDS.indexOf(guildId), 1);
        env.BOT_MEMBER_INTENTS = false;
        env.BOT_MESSAGE_INTENTS = false;
        const jobs = await db.durableJob.findMany({
            where: { guildId },
            select: { id: true },
        });
        await db.jobAttempt.deleteMany({
            where: { jobId: { in: jobs.map((job) => job.id) } },
        });
        await db.durableJob.deleteMany({ where: { guildId } });
        await db.serverAuditEvent.deleteMany({ where: { guildId } });
        await db.guildModuleConfig.deleteMany({ where: { guildId } });
        await db.guildInstallation.delete({ where: { guildId } });
        jest.clearAllMocks();
    });
    afterAll(async () => {
        await db.$disconnect();
    });
    it('deduplicates events and omits content by default', async () => {
        await Promise.all(
            Array.from({ length: 3 }, () =>
                recordAudit({
                    guildId,
                    eventKey: 'deleted',
                    kind: 'message-delete',
                    data: { content: 'private', cached: false },
                })
            )
        );
        const events = await db.serverAuditEvent.findMany({
            where: { guildId },
        });
        expect(events).toHaveLength(1);
        expect(events[0].data).toEqual({ cached: false });
        expect(await db.durableJob.count({ where: { guildId } })).toBe(1);
    });
    it('delivers only to the current server destination and records provider ID', async () => {
        await recordAudit({ guildId, eventKey: 'join', kind: 'member-join' });
        const job = await db.durableJob.findFirstOrThrow({
            where: { guildId },
        });
        const handler = auditHandler(client as unknown as Client);
        expect(await handler.execute(job)).toMatchObject({
            state: 'DELIVERED',
            result: { messageId: 'provider-id' },
        });
        await handler.execute(job);
        expect(channel.send).toHaveBeenCalledTimes(1);
        expect(client.guilds.fetch).toHaveBeenCalledWith({
            guild: guildId,
            force: true,
        });
        expect(guild.channels.fetch).toHaveBeenCalledWith(destination);
        expect(channel.send).toHaveBeenCalledWith(
            expect.objectContaining({ allowedMentions: { parse: [] } })
        );
    });
    it('scrubs previously retained content when retention is disabled', async () => {
        await moduleRegistry.configure(guildId, 'audit-log', true, {
            channelId: destination,
            retainContent: true,
        });
        await recordAudit({
            guildId,
            eventKey: 'edit',
            kind: 'message-edit',
            data: { before: 'secret', after: 'secret2', beforeCached: true },
        });
        await moduleRegistry.configure(guildId, 'audit-log', true, {
            channelId: destination,
            retainContent: false,
        });
        expect(
            (await db.serverAuditEvent.findFirstOrThrow({ where: { guildId } }))
                .data
        ).toEqual({ beforeCached: true });
    });
    it('holds uncertain sends without duplicate notification', async () => {
        channel.send.mockRejectedValueOnce(new Error('lost response'));
        await recordAudit({ guildId, eventKey: 'join', kind: 'member-join' });
        const job = await db.durableJob.findFirstOrThrow({
            where: { guildId },
        });
        const handler = auditHandler(client as unknown as Client);
        expect(await handler.execute(job)).toMatchObject({
            state: 'RECONCILE',
        });
        expect(await handler.execute(job)).toMatchObject({
            state: 'RECONCILE',
        });
        expect(channel.send).toHaveBeenCalledTimes(1);
    });
    it('recovers an interrupted capture and expires retained records', async () => {
        await db.serverAuditEvent.create({
            data: {
                guildId,
                eventKey: 'orphan',
                kind: 'member-join',
                data: {},
                expiresAt: new Date(Date.now() + 10000),
            },
        });
        await recoverAuditEvents();
        expect(await db.durableJob.count({ where: { guildId } })).toBe(1);
        await db.serverAuditEvent.updateMany({
            where: { guildId },
            data: { expiresAt: new Date(0) },
        });
        await expireAuditContent();
        expect(await db.serverAuditEvent.count({ where: { guildId } })).toBe(0);
    });
});
