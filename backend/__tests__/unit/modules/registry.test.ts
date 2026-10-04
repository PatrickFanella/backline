import { z } from 'zod';

import { db } from '../../../src/db';
import { ModuleRegistry } from '../../../src/modules/registry';

jest.mock('../../../src/db', () => ({
    db: {
        guildInstallation: { findUnique: jest.fn() },
        guildModuleConfig: { findUnique: jest.fn(), upsert: jest.fn() },
    },
}));

describe('module registry', () => {
    let registry: ModuleRegistry;
    beforeEach(() => {
        jest.resetAllMocks();
        registry = new ModuleRegistry();
        registry.register({
            id: 'fixture',
            description: 'Fixture',
            version: 2,
            schema: z.object({ channelId: z.string() }).strict(),
            permissions: [],
            intents: [],
            commands: [],
            pendingJobPolicy: 'cancel',
        });
        (db.guildInstallation.findUnique as jest.Mock).mockResolvedValue({
            active: true,
        });
    });
    it('validates configuration and keeps server attribution', async () => {
        await expect(
            registry.configure('123456789', 'fixture', true, {
                unexpected: true,
            })
        ).rejects.toThrow();
        expect(db.guildModuleConfig.upsert).not.toHaveBeenCalled();
        await registry.configure('123456789', 'fixture', true, {
            channelId: 'one',
        });
        expect(db.guildModuleConfig.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    guildId_moduleId: {
                        guildId: '123456789',
                        moduleId: 'fixture',
                    },
                },
            })
        );
    });
    it.each([
        null,
        { enabled: false, version: 2, config: { channelId: 'one' } },
        { enabled: true, version: 1, config: { channelId: 'one' } },
        { enabled: true, version: 2, config: {} },
    ])(
        'does not dispatch disabled, absent or stale configuration %p',
        async (settings) => {
            (db.guildModuleConfig.findUnique as jest.Mock).mockResolvedValue(
                settings
            );
            const action = jest.fn();
            await registry.dispatch('123456789', 'fixture', action);
            expect(action).not.toHaveBeenCalled();
        }
    );
    it('runs enabled modules and isolates failures', async () => {
        (db.guildModuleConfig.findUnique as jest.Mock).mockResolvedValue({
            enabled: true,
            version: 2,
            config: { channelId: 'one' },
        });
        const action = jest.fn().mockRejectedValue(new Error('fixture'));
        await expect(
            registry.dispatch('123456789', 'fixture', action)
        ).resolves.toBeUndefined();
        expect(action).toHaveBeenCalledTimes(1);
    });
    it('rejects unknown modules and missing installations', async () => {
        expect(() => registry.get('missing')).toThrow();
        (db.guildInstallation.findUnique as jest.Mock).mockResolvedValue(null);
        await expect(
            registry.configure('123456789', 'fixture', true, {
                channelId: 'one',
            })
        ).rejects.toThrow();
    });
});
