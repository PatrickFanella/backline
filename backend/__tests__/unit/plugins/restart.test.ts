import { Client } from 'discord.js';

import { PluginLoader } from '../../../src/plugins/PluginLoader';
import { pluginManager } from '../../../src/plugins/PluginManager';

jest.mock('../../../src/plugins/PluginLoader', () => ({
    PluginLoader: jest.fn().mockImplementation(() => ({
        loadAllPlugins: jest.fn().mockResolvedValue(undefined),
        stopAllPlugins: jest.fn().mockResolvedValue(undefined),
        setDiscordClient: jest.fn(),
    })),
}));
it('rebinds plugins to a new client after shutdown', async () => {
    const first = {} as Client,
        second = {} as Client;
    await pluginManager.initialize(
        { pluginDir: 'fixture', dataDir: 'fixture' },
        first
    );
    const old = pluginManager.getLoader()!;
    expect(old.setDiscordClient).toHaveBeenCalledWith(first);
    await pluginManager.shutdown();
    expect(pluginManager.isInitialized()).toBe(false);
    expect(pluginManager.getLoader()).toBeUndefined();
    await pluginManager.initialize(
        { pluginDir: 'fixture', dataDir: 'fixture' },
        second
    );
    expect(PluginLoader).toHaveBeenCalledTimes(2);
    expect(pluginManager.getLoader()!.setDiscordClient).toHaveBeenCalledWith(
        second
    );
    await pluginManager.shutdown();
});
