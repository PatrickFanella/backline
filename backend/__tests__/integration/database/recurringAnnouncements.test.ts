import {
    ChannelType,
    Client,
    PermissionFlagsBits,
    PermissionsBitField,
} from 'discord.js';

import {
    createAnnouncementSeries,
    cancelAnnouncementSeries,
    materializeAnnouncementSeries,
} from '../../../src/community/scheduledUtilities';
import { db } from '../../../src/db';
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
        await db.announcementSeries.deleteMany({ where });
        await db.guildModuleConfig.deleteMany({ where });
        await db.guildInstallation.deleteMany({ where });
    });
    afterAll(async () => {
        env.BOT_GUILD_IDS.splice(0, env.BOT_GUILD_IDS.length, ...priorGuilds);
        await db.$disconnect();
    });
    const seriesInput = () => ({
        ...input(),
        cadence: 'daily',
        disambiguation: 'earlier',
        days: 30,
    });
    async function ready(state: 'DELIVERED' | 'RECONCILE' = 'DELIVERED') {
        const series = await createAnnouncementSeries(
            client,
            guildId,
            actorId,
            'fixture',
            seriesInput()
        );
        await db.durableJob.updateMany({ where: { guildId }, data: { state } });
        const now = new Date(series.nextAt.getTime() + 1000);
        return { series, now };
    }
    it('reserves the first occurrence once under duplicate concurrent requests', async () => {
        const rows = await Promise.all([
            createAnnouncementSeries(
                client,
                guildId,
                actorId,
                'same',
                seriesInput()
            ),
            createAnnouncementSeries(
                client,
                guildId,
                actorId,
                'same',
                seriesInput()
            ),
        ]);
        expect(rows[0].id).toBe(rows[1].id);
        expect(await db.announcementSeries.count({ where: { guildId } })).toBe(
            1
        );
        expect(
            await db.scheduledUtility.count({
                where: { guildId, seriesId: rows[0].id },
            })
        ).toBe(1);
    });
    it('reserves one next occurrence across concurrent and restarted scheduler passes', async () => {
        const { series, now } = await ready();
        await Promise.all([
            materializeAnnouncementSeries(now),
            materializeAnnouncementSeries(now),
        ]);
        await materializeAnnouncementSeries(now);
        expect(
            await db.scheduledUtility.count({
                where: { guildId, seriesId: series.id },
            })
        ).toBe(2);
        const updated = await db.announcementSeries.findUniqueOrThrow({
            where: { id: series.id },
        });
        expect(updated.nextAt.getTime()).toBeGreaterThan(now.getTime());
    });
    it('holds a series after uncertain delivery', async () => {
        const { series, now } = await ready('RECONCILE');
        await materializeAnnouncementSeries(now);
        expect(
            (
                await db.announcementSeries.findUniqueOrThrow({
                    where: { id: series.id },
                })
            ).state
        ).toBe('HELD');
        expect(await db.scheduledUtility.count({ where: { guildId } })).toBe(1);
    });
    it('cancels the series and pending messages atomically', async () => {
        const series = await createAnnouncementSeries(
            client,
            guildId,
            actorId,
            'fixture',
            seriesInput()
        );
        await cancelAnnouncementSeries(client, guildId, actorId, series.id);
        const updated = await db.announcementSeries.findUniqueOrThrow({
            where: { id: series.id },
        });
        expect(updated.state).toBe('CANCELLED');
        expect(updated.content).toBe('');
        expect(
            (await db.durableJob.findFirstOrThrow({ where: { guildId } })).state
        ).toBe('CANCELLED');
        expect(
            (await db.scheduledUtility.findFirstOrThrow({ where: { guildId } }))
                .content
        ).toBe('');
    });
    it('does not materialize while the module is disabled', async () => {
        const { now } = await ready();
        await moduleRegistry.configure(
            guildId,
            'scheduled-utilities',
            false,
            {}
        );
        const log = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await materializeAnnouncementSeries(now);
        } finally {
            log.mockRestore();
        }
        expect(await db.scheduledUtility.count({ where: { guildId } })).toBe(1);
    });
    it('skips old occurrences instead of replaying a backlog', async () => {
        const { series } = await ready();
        const now = new Date(series.nextAt.getTime() + 10 * 86400000 + 1000);
        await materializeAnnouncementSeries(now);
        const events = await db.scheduledUtility.findMany({
            where: { guildId },
            orderBy: { runAt: 'desc' },
        });
        expect(events).toHaveLength(2);
        expect(events[0].runAt.getTime()).toBeGreaterThan(
            now.getTime() - 86400000
        );
    });
});
