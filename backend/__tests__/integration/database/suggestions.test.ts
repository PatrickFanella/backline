import {
    ChannelType,
    Client,
    PermissionFlagsBits,
    PermissionsBitField,
} from 'discord.js';

import {
    createSuggestion,
    expireSuggestions,
    reviewSuggestion,
    suggestionHandler,
    voteSuggestion,
} from '../../../src/community/suggestions';
import { db } from '../../../src/db';
import { JobWorker } from '../../../src/jobs/store';
import { moduleRegistry } from '../../../src/modules/registry';
import { env } from '../../../src/utils/env';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('member suggestions', () => {
    const guildId = '777777777777777881',
        otherGuild = '777777777777777882',
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
        await moduleRegistry.configure(guildId, 'suggestions', true, {
            channelId,
        });
    });
    afterEach(async () => {
        const where = { guildId: { in: [guildId, otherGuild] } };
        await db.jobAttempt.deleteMany({
            where: { job: { guildId: { in: [guildId, otherGuild] } } },
        });
        await db.durableJob.deleteMany({ where });
        await db.communitySuggestion.deleteMany({ where });
        await db.guildModuleConfig.deleteMany({ where });
        await db.guildInstallation.deleteMany({ where });
    });
    afterAll(async () => {
        env.BOT_GUILD_IDS.splice(0, env.BOT_GUILD_IDS.length, ...priorGuilds);
        await db.$disconnect();
    });
    async function published() {
        const record = await createSuggestion(
            client,
            guildId,
            actorId,
            'published',
            'A quiet room @everyone'
        );
        await db.durableJob.updateMany({
            where: { guildId },
            data: { runAt: new Date(Date.now() - 60000) },
        });
        const worker = new JobWorker(
            new Map([['suggestion-publish', suggestionHandler(client)]])
        );
        expect(await worker.tick()).toBe(true);
        const job = await db.durableJob.findFirstOrThrow({
            where: { guildId },
        });
        expect({ state: job.state, error: job.lastError }).toEqual({
            state: 'DELIVERED',
            error: null,
        });
        return record;
    }
    it('reserves one suggestion and action for competing duplicate submissions', async () => {
        const records = await Promise.all([
            createSuggestion(client, guildId, actorId, 'same', 'Idea'),
            createSuggestion(client, guildId, actorId, 'same', 'Idea'),
        ]);
        expect(records[0].id).toBe(records[1].id);
        expect(await db.durableJob.count({ where: { guildId } })).toBe(1);
    });
    it('publishes once with inert mentions and persistent button identities', async () => {
        const record = await published();
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0].allowedMentions).toEqual({ parse: [] });
        expect(
            send.mock.calls[0][0].components[0].toJSON().components[0].custom_id
        ).toBe('suggestion:' + record.id + ':1');
        expect(
            (
                await db.communitySuggestion.findUniqueOrThrow({
                    where: { id: record.id },
                })
            ).deliveryState
        ).toBe('DELIVERED');
    });
    it('keeps one changeable vote per member and blocks cross-server voting', async () => {
        const record = await published();
        await Promise.all([
            voteSuggestion(client, guildId, actorId, record.id, 1),
            voteSuggestion(client, guildId, actorId, record.id, 1),
        ]);
        await voteSuggestion(client, guildId, actorId, record.id, -1);
        expect(
            await db.suggestionVote.count({
                where: { suggestionId: record.id },
            })
        ).toBe(1);
        expect((await db.suggestionVote.findFirstOrThrow()).value).toBe(-1);
        await expect(
            voteSuggestion(client, otherGuild, actorId, record.id, 1)
        ).rejects.toThrow();
    });
    it('requires current manager authority and stops votes after staff review', async () => {
        const record = await published();
        actor.permissions = new PermissionsBitField();
        await expect(
            reviewSuggestion(
                client,
                guildId,
                actorId,
                record.id,
                'ACCEPTED',
                'Useful'
            )
        ).rejects.toThrow('Manage Server');
        actor.permissions.add(PermissionFlagsBits.ManageGuild);
        await reviewSuggestion(
            client,
            guildId,
            actorId,
            record.id,
            'ACCEPTED',
            'Useful'
        );
        await expect(
            voteSuggestion(client, guildId, actorId, record.id, 1)
        ).rejects.toThrow('Open suggestion');
    });
    it('holds a lost publish and never repeats it', async () => {
        const record = await createSuggestion(
            client,
            guildId,
            actorId,
            'lost',
            'Idea'
        );
        send.mockRejectedValue(new Error('Lost response'));
        await db.durableJob.updateMany({
            where: { guildId },
            data: { runAt: new Date(Date.now() - 60000) },
        });
        const worker = new JobWorker(
            new Map([['suggestion-publish', suggestionHandler(client)]])
        );
        await worker.tick();
        await worker.tick();
        expect(send).toHaveBeenCalledTimes(1);
        expect(
            (
                await db.communitySuggestion.findUniqueOrThrow({
                    where: { id: record.id },
                })
            ).deliveryState
        ).toBe('UNCERTAIN');
    });
    it('deletes aged suggestion content, votes and worker receipts together', async () => {
        const record = await published();
        await voteSuggestion(client, guildId, actorId, record.id, 1);
        await db.communitySuggestion.update({
            where: { id: record.id },
            data: { createdAt: new Date(Date.now() - 31 * 86400000) },
        });
        await expireSuggestions();
        expect(await db.communitySuggestion.count({ where: { guildId } })).toBe(
            0
        );
        expect(await db.durableJob.count({ where: { guildId } })).toBe(0);
        expect(await db.suggestionVote.count()).toBe(0);
    });
});
