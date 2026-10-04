import { Interaction, PermissionFlagsBits } from 'discord.js';

import { coreCommands, routeInteraction } from '../../../src/bot/commands';
import { db } from '../../../src/db';
import { moduleRegistry } from '../../../src/modules/registry';

jest.mock('../../../src/db', () => ({
    db: {
        guildInstallation: { findUnique: jest.fn() },
        guildModuleConfig: { findMany: jest.fn(), findUnique: jest.fn() },
    },
}));
jest.spyOn(moduleRegistry, 'configure');
function interaction(commandName = 'help') {
    return {
        isRepliable: () => true,
        isButton: () => false,
        inGuild: () => true,
        isChatInputCommand: () => true,
        guildId: 'A',
        user: { id: 'manager' },
        commandName,
        guild: {
            ownerId: 'owner',
            members: {
                fetch: jest.fn().mockResolvedValue({
                    id: 'manager',
                    permissions: {
                        has: (value: bigint) =>
                            value === PermissionFlagsBits.ManageGuild,
                    },
                }),
                fetchMe: jest
                    .fn()
                    .mockResolvedValue({ permissions: { has: () => true } }),
            },
        },
        client: { options: { intents: { has: () => true } } },
        options: { getString: () => 'activity', getBoolean: () => false },
        deferReply: jest.fn(),
        editReply: jest.fn(),
        reply: jest.fn(),
        deferred: true,
    };
}
describe('core command routing', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (db.guildInstallation.findUnique as jest.Mock).mockResolvedValue({
            active: true,
        });
        (db.guildModuleConfig.findMany as jest.Mock).mockResolvedValue([]);
        (moduleRegistry.configure as jest.Mock).mockResolvedValue(undefined);
    });
    it('declares four guild-only commands', () => {
        expect(coreCommands.map((command) => command.name)).toEqual([
            'help',
            'setup',
            'status',
            'settings',
        ]);
        expect(
            coreCommands.every(
                (command) =>
                    command.contexts?.includes(0) &&
                    command.contexts.length === 1
            )
        ).toBe(true);
    });
    it.each(['help', 'setup', 'status'])(
        'acknowledges %s before database access',
        async (name) => {
            const fixture = interaction(name);
            await routeInteraction(fixture as unknown as Interaction);
            expect(fixture.deferReply.mock.invocationCallOrder[0]).toBeLessThan(
                (db.guildInstallation.findUnique as jest.Mock).mock
                    .invocationCallOrder[0]
            );
            expect(fixture.editReply).toHaveBeenCalled();
        }
    );
    it('checks current management permission before configuration', async () => {
        const fixture = interaction('settings');
        fixture.guild.members.fetch.mockResolvedValue({
            id: 'manager',
            permissions: { has: () => false },
        });
        await routeInteraction(fixture as unknown as Interaction);
        expect(moduleRegistry.configure).not.toHaveBeenCalled();
        expect(fixture.editReply).toHaveBeenCalledWith(
            expect.stringContaining('permission is required')
        );
    });
    it('saves settings for the interaction server', async () => {
        await routeInteraction(
            interaction('settings') as unknown as Interaction
        );
        expect(moduleRegistry.configure).toHaveBeenCalledWith(
            'A',
            'activity',
            false,
            {}
        );
    });
    it('rejects direct-message commands', async () => {
        const fixture = interaction();
        fixture.inGuild = () => false;
        await routeInteraction(fixture as unknown as Interaction);
        expect(fixture.reply).toHaveBeenCalled();
        expect(db.guildInstallation.findUnique).not.toHaveBeenCalled();
    });
    it('explains unknown components', async () => {
        const fixture = interaction();
        fixture.isChatInputCommand = () => false;
        await routeInteraction(fixture as unknown as Interaction);
        expect(fixture.editReply).toHaveBeenCalledWith(
            expect.stringContaining('unknown or expired')
        );
    });
    it('isolates database failure after acknowledgment', async () => {
        (db.guildInstallation.findUnique as jest.Mock).mockRejectedValue(
            new Error('private')
        );
        const fixture = interaction();
        await expect(
            routeInteraction(fixture as unknown as Interaction)
        ).resolves.toBeUndefined();
        expect(fixture.editReply).toHaveBeenCalledWith(
            expect.stringContaining('action failed')
        );
    });
});
