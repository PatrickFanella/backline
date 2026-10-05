import { Collection, Interaction } from 'discord.js';

import { routeCustomCommands } from '../../../src/community/customCommands';
import { db } from '../../../src/db';
import { moduleRegistry } from '../../../src/modules/registry';
import { env } from '../../../src/utils/env';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('server custom reply authorization', () => {
    const guildId = '777777777777777841',
        otherGuild = '777777777777777842',
        memberId = '777777777777777843',
        roleId = '777777777777777844';
    let oldGuilds: string[];
    const roles = new Collection<string, never>();
    const editReply = jest.fn().mockResolvedValue(undefined);
    const interaction = (name: string | null, id = guildId) =>
        ({
            isChatInputCommand: () => true,
            commandName: 'custom',
            guild: {
                id,
                name: 'Custom fixture',
                members: {
                    fetch: jest.fn().mockResolvedValue({
                        id: memberId,
                        displayName: 'Member',
                        user: { bot: false },
                        roles: { cache: roles },
                    }),
                },
            },
            user: { id: memberId },
            channel: { name: 'general' },
            options: { getString: () => name },
            editReply,
        }) as unknown as Interaction;
    beforeAll(() => {
        oldGuilds = [...env.BOT_GUILD_IDS];
        env.BOT_GUILD_IDS.push(guildId, otherGuild);
    });
    beforeEach(async () => {
        roles.clear();
        editReply.mockClear();
        for (const id of [guildId, otherGuild])
            await db.guildInstallation.create({
                data: { guildId: id, name: 'Custom fixture', active: true },
            });
        await moduleRegistry.configure(guildId, 'custom-commands', true, {
            commands: [
                {
                    name: 'rules',
                    response: { content: 'Hello {user} in {server}' },
                    requiredRoles: [roleId],
                },
                {
                    name: 'open',
                    response: {
                        title: 'Welcome',
                        description: 'Read the rules in {channel}.',
                    },
                },
            ],
        });
    });
    afterEach(async () => {
        const where = { guildId: { in: [guildId, otherGuild] } };
        await db.guildModuleConfig.deleteMany({ where });
        await db.guildInstallation.deleteMany({ where });
    });
    afterAll(async () => {
        env.BOT_GUILD_IDS.splice(0, env.BOT_GUILD_IDS.length, ...oldGuilds);
        await db.$disconnect();
    });
    it('lists only commands allowed by current roles and rejects access without the role', async () => {
        await routeCustomCommands(interaction(null));
        expect(editReply).toHaveBeenLastCalledWith(
            'Available custom commands: open'
        );
        await routeCustomCommands(interaction('rules'));
        expect(editReply).toHaveBeenLastCalledWith(
            'This custom command is unavailable or requires a configured role.'
        );
        roles.set(roleId, {} as never);
        await routeCustomCommands(interaction('rules'));
        expect(editReply).toHaveBeenLastCalledWith({
            content: 'Hello Member in Custom fixture',
            allowedMentions: { parse: [], repliedUser: false },
        });
        roles.clear();
        await routeCustomCommands(interaction('rules'));
        expect(editReply).toHaveBeenLastCalledWith(
            'This custom command is unavailable or requires a configured role.'
        );
    });
    it('does not reuse another server configuration and denies disabled modules', async () => {
        await routeCustomCommands(interaction('open', otherGuild));
        expect(editReply).toHaveBeenLastCalledWith(
            'Custom commands are disabled for this server.'
        );
        await moduleRegistry.configure(guildId, 'custom-commands', false, {});
        await routeCustomCommands(interaction('open'));
        expect(editReply).toHaveBeenLastCalledWith(
            'Custom commands are disabled for this server.'
        );
    });
    it('denies a revoked application account before rendering its reply', async () => {
        const account = await db.user.create({
            data: {
                discordId: memberId,
                username: 'custom-banned-fixture',
                discriminator: '0',
                role: 'BANNED',
                verified: false,
                accessToken: 'fixture-access',
                refreshToken: 'fixture-refresh',
                accessTokenExpiresAt: new Date(Date.now() + 60000),
                lastSeenAt: new Date(),
            },
        });
        try {
            await routeCustomCommands(interaction('open'));
            expect(editReply).toHaveBeenLastCalledWith(
                'Custom commands are unavailable for this account.'
            );
        } finally {
            await db.user.delete({ where: { id: account.id } });
        }
    });
});
