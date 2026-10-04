import { Client, Collection, PermissionFlagsBits } from 'discord.js';

import {
    collectTranscript,
    openTicket,
    ticketAction,
    ticketOverwrites,
} from '../../../src/community/tickets';
import { db } from '../../../src/db';
import { moduleRegistry } from '../../../src/modules/registry';
import { env } from '../../../src/utils/env';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const guildId = '777777777777777771',
    openerId = '777777777777777772',
    staffId = '777777777777777773',
    otherId = '777777777777777774',
    roleId = '777777777777777775';
describe('ticket transcript bounds', () => {
    it('omits content by default and identifies a truncated export', async () => {
        const fetch = jest
            .fn()
            .mockResolvedValue(
                new Collection(
                    Array.from({ length: 100 }, (_, i) => [
                        String(i),
                        {
                            id: String(i),
                            author: { id: openerId },
                            createdAt: new Date(0),
                            content: 'private',
                        },
                    ])
                )
            );
        const result = await collectTranscript(
            { messages: { fetch } } as never,
            false
        );
        expect(fetch).toHaveBeenCalledTimes(10);
        expect(result.truncated).toBe(true);
        expect(result.messages).toHaveLength(1000);
        expect(result.messages[0]).not.toHaveProperty('content');
    });
    it('does not inherit a category or another ticket participant overwrite', () => {
        const overwrites = ticketOverwrites(
            guildId,
            'bot',
            [openerId],
            [roleId]
        );
        expect(overwrites.map((row) => row.id)).toEqual([
            guildId,
            roleId,
            openerId,
            'bot',
        ]);
        expect(overwrites[0]).toMatchObject({
            deny: [PermissionFlagsBits.ViewChannel],
        });
        expect(overwrites.find((row) => row.id === otherId)).toBeUndefined();
    });
});
databaseTests('private ticket persistence', () => {
    const opener = {
        id: openerId,
        permissions: { has: () => false },
        roles: { cache: new Collection() },
    };
    const staff = {
        id: staffId,
        permissions: { has: () => false },
        roles: { cache: new Collection([[roleId, {}]]) },
    };
    const outsider = {
        id: otherId,
        permissions: { has: () => false },
        roles: { cache: new Collection() },
    };
    const bot = { id: '777777777777777776', permissions: { has: () => true } };
    const channel = {
        id: '777777777777777777',
        type: 0,
        topic: '',
        permissionsFor: () => ({ has: () => true }),
        permissionOverwrites: { set: jest.fn().mockResolvedValue(undefined) },
        messages: { fetch: jest.fn().mockResolvedValue(new Collection()) },
    };
    const guild = {
        id: guildId,
        ownerId: 'owner',
        members: {
            fetch: jest.fn(),
            fetchMe: jest.fn().mockResolvedValue(bot),
        },
        roles: { fetch: jest.fn().mockResolvedValue({ id: roleId }) },
        channels: {
            create: jest.fn(),
            fetch: jest.fn().mockResolvedValue(channel),
        },
    };
    const client = {
        guilds: { fetch: jest.fn().mockResolvedValue(guild) },
    } as unknown as Client;
    beforeEach(async () => {
        env.BOT_GUILD_IDS.push(guildId);
        await db.guildInstallation.upsert({
            where: { guildId },
            create: { guildId, name: 'fixture', active: true },
            update: { active: true },
        });
        await moduleRegistry.configure(guildId, 'tickets', true, {
            staffRoles: [roleId],
        });
        guild.members.fetch.mockImplementation(({ user }: { user: string }) =>
            Promise.resolve(
                user === openerId ? opener : user === staffId ? staff : outsider
            )
        );
        guild.channels.create.mockImplementation((data: { topic: string }) => {
            channel.topic = data.topic;
            return Promise.resolve(channel);
        });
    });
    afterEach(async () => {
        await db.ticketTranscript.deleteMany({ where: { guildId } });
        await db.ticketAction.deleteMany({ where: { guildId } });
        await db.supportTicket.deleteMany({ where: { guildId } });
        await db.guildModuleConfig.deleteMany({ where: { guildId } });
        await db.guildInstallation.delete({ where: { guildId } });
        env.BOT_GUILD_IDS.splice(env.BOT_GUILD_IDS.indexOf(guildId), 1);
        jest.clearAllMocks();
    });
    afterAll(async () => {
        await db.$disconnect();
    });
    it('reserves one channel under concurrent opens and duplicate requests', async () => {
        const rows = await Promise.all([
            openTicket(client, guildId, openerId, 'one'),
            openTicket(client, guildId, openerId, 'two'),
        ]);
        expect(new Set(rows.map((row) => row.id)).size).toBe(1);
        expect(guild.channels.create).toHaveBeenCalledTimes(1);
        const row = await openTicket(client, guildId, openerId, 'one');
        expect(row.state).toBe('OPEN');
        expect(guild.channels.create).toHaveBeenCalledTimes(1);
    });
    it('denies another member reading a ticket transcript', async () => {
        const row = await openTicket(client, guildId, openerId, 'open');
        await expect(
            ticketAction(client, guildId, otherId, 'read', row.id, 'transcript')
        ).rejects.toThrow('access denied');
        expect(channel.messages.fetch).not.toHaveBeenCalled();
    });
    it('preserves close/reopen state and staff role policy across reloads', async () => {
        const row = await openTicket(client, guildId, openerId, 'open');
        expect(
            (
                await ticketAction(
                    client,
                    guildId,
                    openerId,
                    'close',
                    row.id,
                    'close'
                )
            ).state
        ).toBe('DELIVERED');
        expect(
            (
                await db.supportTicket.findUniqueOrThrow({
                    where: { id: row.id },
                })
            ).state
        ).toBe('CLOSED');
        await expect(
            moduleRegistry.configure(guildId, 'tickets', true, {
                staffRoles: [otherId],
            })
        ).rejects.toThrow('Expire existing');
        expect(
            (
                await ticketAction(
                    client,
                    guildId,
                    staffId,
                    'reopen',
                    row.id,
                    'reopen'
                )
            ).state
        ).toBe('DELIVERED');
        expect(
            (
                await db.supportTicket.findUniqueOrThrow({
                    where: { id: row.id },
                })
            ).state
        ).toBe('OPEN');
    });
    it('holds a lost channel creation response instead of creating again', async () => {
        guild.channels.create.mockRejectedValueOnce(new Error('lost'));
        const row = await openTicket(client, guildId, openerId, 'open');
        expect(row.heldActionId).not.toBeNull();
        expect((await openTicket(client, guildId, openerId, 'open')).id).toBe(
            row.id
        );
        expect(
            (await openTicket(client, guildId, openerId, 'new-request')).id
        ).toBe(row.id);
        expect(guild.channels.create).toHaveBeenCalledTimes(1);
    });
    it('holds a lost overwrite response and rejects further changes', async () => {
        const row = await openTicket(client, guildId, openerId, 'open');
        channel.permissionOverwrites.set.mockRejectedValueOnce(
            new Error('lost')
        );
        expect(
            (
                await ticketAction(
                    client,
                    guildId,
                    staffId,
                    'close',
                    row.id,
                    'close'
                )
            ).state
        ).toBe('UNCERTAIN');
        await expect(
            ticketAction(client, guildId, staffId, 'new', row.id, 'reopen')
        ).rejects.toThrow('held');
        expect(channel.permissionOverwrites.set).toHaveBeenCalledTimes(1);
    });
    it('exports only local metadata when content retention is disabled', async () => {
        const row = await openTicket(client, guildId, openerId, 'open');
        await ticketAction(
            client,
            guildId,
            openerId,
            'export',
            row.id,
            'transcript'
        );
        expect(
            (
                await db.ticketTranscript.findUniqueOrThrow({
                    where: { ticketId: row.id },
                })
            ).containsContent
        ).toBe(false);
    });
});
