import {
    Client,
    Collection,
    GuildMember,
    PermissionFlagsBits,
    PermissionsBitField,
} from 'discord.js';

import { RadioRuntime } from '../../../src/audio/radio';
import { db } from '../../../src/db';
import { moduleRegistry } from '../../../src/modules/registry';

jest.mock('../../../src/db', () => ({
    db: {
        user: { count: jest.fn() },
        guildModuleConfig: { findUniqueOrThrow: jest.fn() },
    },
}));
jest.spyOn(moduleRegistry, 'enabled');
describe('current voice playback controls', () => {
    let runtime: RadioRuntime,
        listeners: Collection<string, GuildMember>,
        actorChannel: string,
        manager: boolean;
    const player = { pause: jest.fn(), unpause: jest.fn() },
        volume = { setVolume: jest.fn() };
    const session = {
        channelId: 'channel',
        requesterId: 'requester',
        stopping: false,
        player,
        config: { volume: 25 },
        resource: { volume },
    };
    const client = {
        guilds: {
            fetch: jest.fn(() =>
                Promise.resolve({
                    members: {
                        fetch: jest.fn(({ user }: { user: string }) =>
                            Promise.resolve({
                                id: user,
                                user: { bot: false },
                                voice: { channelId: actorChannel },
                                roles: { cache: new Map() },
                                permissions: new PermissionsBitField(
                                    manager
                                        ? [PermissionFlagsBits.ManageGuild]
                                        : []
                                ),
                                guild: {
                                    channels: {
                                        fetch: jest.fn(() =>
                                            Promise.resolve({
                                                type: 2,
                                                members: listeners,
                                            })
                                        ),
                                    },
                                },
                            })
                        ),
                    },
                })
            ),
        },
    } as unknown as Client;
    beforeEach(() => {
        jest.clearAllMocks();
        runtime = new RadioRuntime();
        actorChannel = 'channel';
        manager = false;
        listeners = new Collection(
            ['one', 'two', 'three', 'four'].map((id) => [
                id,
                { id, user: { bot: false } } as GuildMember,
            ])
        );
        (runtime as unknown as { sessions: Map<string, unknown> }).sessions.set(
            'guild',
            session
        );
        (db.user.count as jest.Mock).mockResolvedValue(0);
        (db.guildModuleConfig.findUniqueOrThrow as jest.Mock).mockResolvedValue(
            { config: { volume: 25 } }
        );
        (moduleRegistry.enabled as jest.Mock).mockResolvedValue(true);
        jest.spyOn(runtime, 'stop').mockResolvedValue(undefined);
    });
    it('counts distinct current listeners and removes departed votes', async () => {
        expect(
            await runtime.control(client, 'guild', 'one', 'skip')
        ).toMatchObject({ skipped: false, votes: 1, required: 2 });
        expect(
            await runtime.control(client, 'guild', 'one', 'skip')
        ).toMatchObject({ skipped: false, votes: 1 });
        listeners.delete('one');
        listeners.set('five', {
            id: 'five',
            user: { bot: false },
        } as GuildMember);
        expect(
            await runtime.control(client, 'guild', 'two', 'skip')
        ).toMatchObject({ skipped: false, votes: 1 });
        expect(
            await runtime.control(client, 'guild', 'three', 'skip')
        ).toMatchObject({ skipped: true });
        expect(runtime.stop).toHaveBeenCalledWith('guild', 'Queue skip');
    });
    it('requires the current channel and requester or DJ for pause and volume', async () => {
        await expect(
            runtime.control(client, 'guild', 'one', 'pause')
        ).rejects.toThrow('Requester');
        actorChannel = 'other';
        await expect(
            runtime.control(client, 'guild', 'requester', 'pause')
        ).rejects.toThrow('Join');
        actorChannel = 'channel';
        await runtime.control(client, 'guild', 'requester', 'pause');
        expect(player.pause).toHaveBeenCalled();
        await expect(
            runtime.control(client, 'guild', 'requester', 'volume', 26)
        ).rejects.toThrow('limit');
        await runtime.control(client, 'guild', 'requester', 'volume', 10);
        expect(volume.setVolume).toHaveBeenCalledWith(0.1);
    });
    it('rechecks DJ revocation and banned accounts', async () => {
        manager = true;
        await runtime.control(client, 'guild', 'one', 'resume');
        manager = false;
        await expect(
            runtime.control(client, 'guild', 'one', 'resume')
        ).rejects.toThrow('Requester');
        (db.user.count as jest.Mock).mockResolvedValue(1);
        await expect(
            runtime.control(client, 'guild', 'requester', 'skip')
        ).rejects.toThrow('account');
    });
});
