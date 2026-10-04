import { EventEmitter } from 'events';

import { registerGuildCommands } from '../../../src/bot/commands';
import { startBot } from '../../../src/bot/startup';
import { db } from '../../../src/db';
import { recordInstallation } from '../../../src/guilds/installations';
import { moduleRegistry } from '../../../src/modules/registry';
import { env } from '../../../src/utils/env';

const guild = { id: '123456789', name: 'fixture', icon: null };
jest.mock('discord.js', () => {
    const actual = jest.requireActual('discord.js');
    return {
        ...actual,
        Client: class extends EventEmitter {
            guilds = { cache: new actual.Collection([[guild.id, guild]]) };
            isReady = () => false;
            destroy = jest.fn().mockResolvedValue(undefined);
            login() {
                queueMicrotask(() => this.emit('clientReady'));
                return Promise.resolve('unused');
            }
        },
    };
});
jest.mock('../../../src/db', () => ({
    db: { guildInstallation: { findMany: jest.fn() } },
}));
jest.mock('../../../src/guilds/installations', () => ({
    recordInstallation: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../src/bot/collectors', () => ({
    registerCollectors: jest.fn(),
}));
jest.mock('../../../src/bot/commands', () => ({
    registerGuildCommands: jest.fn().mockResolvedValue(undefined),
    routeInteraction: jest.fn(),
}));
jest.mock('../../../src/plugins', () => ({
    pluginManager: {
        initialize: jest.fn().mockResolvedValue(undefined),
        executeDiscordHook: jest.fn(),
    },
}));
describe('automatic installation provisioning', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        env.BOT_RUN_JOBS = false;
        env.BOT_REGISTER_COMMANDS = false;
        env.BOT_GUILD_IDS = [];
        jest.spyOn(moduleRegistry, 'dispatch').mockResolvedValue(undefined);
    });
    afterEach(() => {
        jest.restoreAllMocks();
        env.BOT_RUN_JOBS = true;
        env.BOT_GUILD_IDS = ['123456789', '987654321'];
    });
    it('registers a new installation without operator registration flags or allowlist entries', async () => {
        (db.guildInstallation.findMany as jest.Mock).mockResolvedValue([]);
        const client = await startBot();
        expect(registerGuildCommands).toHaveBeenCalledWith(client, [guild.id]);
        await client.destroy();
    });
    it('preserves known command deployments on ordinary restart and deactivates missing installs', async () => {
        (db.guildInstallation.findMany as jest.Mock).mockResolvedValue([
            { guildId: guild.id, name: 'fixture', icon: null },
            { guildId: 'missing', name: 'missing', icon: null },
        ]);
        const client = await startBot();
        expect(registerGuildCommands).not.toHaveBeenCalled();
        expect(recordInstallation).toHaveBeenCalledWith(
            { id: 'missing', name: 'missing', icon: null },
            false
        );
        await client.destroy();
    });
});
