import { Client, Collection, PermissionFlagsBits } from 'discord.js';

import { selfRolesConfig } from '../../../src/community/config';
import {
    applyRoleChoice,
    planRoleChoice,
    roleConfigHash,
} from '../../../src/community/selfRoles';
import { db } from '../../../src/db';
import { moduleRegistry } from '../../../src/modules/registry';
import { env } from '../../../src/utils/env';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const guildId = '888888888888888888',
    userId = '999999999999999999',
    first = '111111111111111112',
    second = '111111111111111113';
const config = selfRolesConfig.parse({
    channelId: '666666666666666666',
    roles: [
        { roleId: first, label: 'First', group: 'color' },
        { roleId: second, label: 'Second', group: 'color' },
    ],
});
describe('role policy planning', () => {
    it('replaces an exclusive role and preserves unrelated roles', () => {
        expect(
            planRoleChoice(config, new Set([first, 'unrelated']), {
                toggle: second,
            })
        ).toEqual({ add: [second], remove: [first] });
    });
    it('rejects multiple choices in one exclusive group', () => {
        expect(() =>
            planRoleChoice(config, new Set(), { selected: [first, second] })
        ).toThrow('exclusive');
    });
    it('requires prerequisites and prevents removing an in-use prerequisite', () => {
        const policy = selfRolesConfig.parse({
            roles: [
                { roleId: first, label: 'Base' },
                { roleId: second, label: 'Dependent', requires: [first] },
            ],
        });
        expect(() =>
            planRoleChoice(policy, new Set(), { toggle: second })
        ).toThrow('Required');
        expect(() =>
            planRoleChoice(policy, new Set([first, second]), { toggle: first })
        ).toThrow('Required');
    });
    it('rejects roles outside the configured panel', () => {
        expect(() =>
            planRoleChoice(config, new Set(), { toggle: 'unmanaged' })
        ).toThrow('not offered');
    });
});
databaseTests('persistent self-service role choices', () => {
    const member = {
        roles: {
            cache: new Collection<string, unknown>(),
            add: jest.fn(),
            remove: jest.fn(),
        },
    };
    const bot = {
        permissions: { has: () => true },
        roles: { highest: { comparePositionTo: () => 1 } },
    };
    const role = {
        id: first,
        guild: { id: guildId },
        managed: false,
        permissions: { bitfield: BigInt(0) },
    };
    const guild = {
        id: guildId,
        members: { fetch: jest.fn(), fetchMe: jest.fn() },
        roles: { fetch: jest.fn() },
    };
    const client = { guilds: { fetch: jest.fn() } };
    let panelId: string;
    beforeEach(async () => {
        env.BOT_GUILD_IDS.push(guildId);
        await db.guildInstallation.upsert({
            where: { guildId },
            create: { guildId, name: 'fixture', active: true },
            update: { active: true },
        });
        await moduleRegistry.configure(guildId, 'self-roles', true, config);
        const panel = await db.rolePanel.create({
            data: {
                guildId,
                configHash: roleConfigHash(config),
                channelId: config.channelId!,
                messageId: 'message',
                state: 'DELIVERED',
            },
        });
        panelId = panel.id;
        role.permissions.bitfield = BigInt(0);
        role.managed = false;
        member.roles.cache.clear();
        client.guilds.fetch.mockResolvedValue(guild);
        guild.members.fetch.mockResolvedValue(member);
        guild.members.fetchMe.mockResolvedValue(bot);
        guild.roles.fetch.mockImplementation((id: string) =>
            Promise.resolve({ ...role, id })
        );
        member.roles.add.mockImplementation((id: string) => {
            member.roles.cache.set(id, {});
            return Promise.resolve(member);
        });
        member.roles.remove.mockImplementation((id: string) => {
            member.roles.cache.delete(id);
            return Promise.resolve(member);
        });
    });
    afterEach(async () => {
        env.BOT_GUILD_IDS.splice(env.BOT_GUILD_IDS.indexOf(guildId), 1);
        await db.roleChoiceLock.deleteMany({ where: { guildId } });
        await db.roleChoice.deleteMany({ where: { guildId } });
        await db.rolePanel.deleteMany({ where: { guildId } });
        await db.guildModuleConfig.deleteMany({ where: { guildId } });
        await db.guildInstallation.delete({ where: { guildId } });
        jest.clearAllMocks();
    });
    afterAll(async () => {
        await db.$disconnect();
    });
    const choose = (requestId = 'request') =>
        applyRoleChoice(
            client as unknown as Client,
            guildId,
            userId,
            requestId,
            panelId,
            'message',
            { toggle: first }
        );
    it('does not toggle again when the same request is delivered twice', async () => {
        const results = await Promise.all(
            Array.from({ length: 3 }, () => choose())
        );
        expect(new Set(results.map((result) => result.id)).size).toBe(1);
        expect((await choose()).state).toBe('DELIVERED');
        expect(member.roles.add).toHaveBeenCalledTimes(1);
        expect(member.roles.cache.has(first)).toBe(true);
    });
    it('rejects stale panels after a configuration change', async () => {
        await moduleRegistry.configure(guildId, 'self-roles', true, {
            ...config,
            title: 'New policy',
        });
        expect((await choose()).state).toBe('DENIED');
        expect(member.roles.add).not.toHaveBeenCalled();
    });
    it.each(['privileged', 'managed'])(
        'rejects a role that became %s after publishing',
        async (kind) => {
            if (kind === 'privileged')
                role.permissions.bitfield = PermissionFlagsBits.ManageRoles;
            else role.managed = true;
            expect((await choose()).state).toBe('DENIED');
            expect(member.roles.add).not.toHaveBeenCalled();
        }
    );
    it('holds a lost mutation response and blocks later choices', async () => {
        member.roles.add.mockRejectedValueOnce(new Error('lost'));
        expect((await choose()).state).toBe('UNCERTAIN');
        expect((await choose()).state).toBe('UNCERTAIN');
        await expect(choose('second-request')).rejects.toThrow(
            'previous role action'
        );
        expect(member.roles.add).toHaveBeenCalledTimes(1);
    });
});
