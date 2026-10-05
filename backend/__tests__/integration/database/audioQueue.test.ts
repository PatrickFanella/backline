import { randomUUID } from 'node:crypto';

import { Client, PermissionFlagsBits, PermissionsBitField } from 'discord.js';

import {
    claimQueue,
    enqueue,
    finishQueue,
    loadPlaylist,
    queueItems,
    queueSettings,
    recoverQueues,
    savePlaylist,
    startQueue,
    maintainQueues,
} from '../../../src/audio/queue';
import { radioRuntime } from '../../../src/audio/radio';
import { db } from '../../../src/db';
import { moduleRegistry } from '../../../src/modules/registry';
import { env } from '../../../src/utils/env';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('durable server audio queues', () => {
    const guildId = '777777777777777821',
        otherGuild = '777777777777777822',
        actorId = '777777777777777823',
        memberId = '777777777777777825',
        channelId = '777777777777777824';
    let permitted = true,
        previous: string[],
        voice: boolean;
    const client = {
        guilds: {
            fetch: jest.fn(() =>
                Promise.resolve({
                    members: {
                        fetch: jest.fn(({ user }: { user: string }) =>
                            Promise.resolve({
                                id: user,
                                user: { bot: false },
                                voice: { channelId },
                                permissions: new PermissionsBitField(
                                    permitted && user === actorId
                                        ? [PermissionFlagsBits.ManageGuild]
                                        : []
                                ),
                                roles: { cache: new Map() },
                            })
                        ),
                    },
                })
            ),
        },
    } as unknown as Client;
    beforeAll(() => {
        previous = [...env.BOT_GUILD_IDS];
        voice = env.BOT_VOICE_INTENT;
        env.BOT_GUILD_IDS.push(guildId, otherGuild);
        env.BOT_VOICE_INTENT = true;
    });
    beforeEach(async () => {
        permitted = true;
        for (const id of [guildId, otherGuild]) {
            await db.guildInstallation.create({
                data: { guildId: id, name: 'Audio fixture', active: true },
            });
            await moduleRegistry.configure(id, 'audio', true, {
                queuesEnabled: true,
            });
        }
    });
    afterEach(async () => {
        const where = { guildId: { in: [guildId, otherGuild] } };
        await db.audioPlaylist.deleteMany({ where });
        await db.audioQueue.deleteMany({ where });
        await db.guildModuleConfig.deleteMany({ where });
        await db.guildInstallation.deleteMany({ where });
    });
    afterAll(async () => {
        env.BOT_GUILD_IDS.splice(0, env.BOT_GUILD_IDS.length, ...previous);
        env.BOT_VOICE_INTENT = voice;
        await db.$disconnect();
    });
    const add = (server = guildId) =>
        enqueue(client, server, actorId, 'defcon', 1);
    const addMember = () => enqueue(client, guildId, memberId, 'defcon', 1);
    it('serializes concurrent queue claims and ignores stale completion', async () => {
        await add();
        await add();
        const outcomes = await Promise.allSettled([
            claimQueue(guildId),
            claimQueue(guildId),
        ]);
        expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(
            1
        );
        const owned = await db.audioQueue.findUniqueOrThrow({
            where: { guildId },
        });
        expect(await finishQueue(guildId, randomUUID(), true)).toBeNull();
        expect(queueItems.parse(owned.items)).toHaveLength(2);
        await finishQueue(guildId, owned.claimId!, true);
        expect(
            queueItems.parse(
                (await db.audioQueue.findUniqueOrThrow({ where: { guildId } }))
                    .items
            )
        ).toHaveLength(1);
    });
    it('preserves the pending item after interruption and expired lease recovery', async () => {
        await add();
        const claim = await claimQueue(guildId);
        await db.audioQueue.update({
            where: { guildId },
            data: { leaseUntil: new Date(0) },
        });
        await recoverQueues();
        const row = await db.audioQueue.findUniqueOrThrow({
            where: { guildId },
        });
        expect(row.state).toBe('INTERRUPTED');
        expect(queueItems.parse(row.items)).toHaveLength(1);
        expect(await finishQueue(guildId, claim!.claimId!, true)).toBeNull();
        const restarted = await claimQueue(guildId);
        await finishQueue(guildId, restarted!.claimId!, false);
        expect(
            (await db.audioQueue.findUniqueOrThrow({ where: { guildId } }))
                .state
        ).toBe('INTERRUPTED');
    });
    it('rotates completed loop entries and prevents clearing an active claim', async () => {
        await add();
        await add();
        await queueSettings(client, guildId, actorId, 'loop', true);
        const claim = await claimQueue(guildId),
            before = queueItems.parse(claim!.items);
        await expect(
            queueSettings(client, guildId, actorId, 'clear')
        ).rejects.toThrow('Stop playback');
        await finishQueue(guildId, claim!.claimId!, true);
        const after = queueItems.parse(
            (await db.audioQueue.findUniqueOrThrow({ where: { guildId } }))
                .items
        );
        expect(after.map((i) => i.id)).toEqual([before[1].id, before[0].id]);
    });
    it('enforces ten pending entries per member and rejects malformed sources', async () => {
        await Promise.all(Array.from({ length: 10 }, () => add()));
        await expect(add()).rejects.toThrow('capacity');
        await expect(
            enqueue(client, guildId, actorId, 'https://localhost/private', 1)
        ).rejects.toThrow();
        await expect(
            enqueue(client, guildId, actorId, 'defcon', 31)
        ).rejects.toThrow();
    });
    it('keeps playlists server-scoped and checks current DJ authority', async () => {
        await add();
        await savePlaylist(client, guildId, actorId, 'One');
        await expect(
            loadPlaylist(client, otherGuild, actorId, 'One')
        ).rejects.toThrow();
        permitted = false;
        await expect(
            savePlaylist(client, guildId, actorId, 'Two')
        ).rejects.toThrow('DJ');
        permitted = true;
        await queueSettings(client, guildId, actorId, 'clear');
        await loadPlaylist(client, guildId, actorId, 'One');
        const items = queueItems.parse(
            (await db.audioQueue.findUniqueOrThrow({ where: { guildId } }))
                .items
        );
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ requesterId: actorId, channelId });
    });
    it('does not move an advancing queue to a different voice channel', async () => {
        await add();
        await expect(
            startQueue(
                client,
                guildId,
                actorId,
                Date.now() + 60000,
                '777777777777777899'
            )
        ).rejects.toThrow('left its voice channel');
        const row = await db.audioQueue.findUniqueOrThrow({
            where: { guildId },
        });
        expect(row.state).toBe('IDLE');
        expect(queueItems.parse(row.items)).toHaveLength(1);
    });
    it('continues a member request under the original current DJ', async () => {
        const sessions = new Map<string, { id: string }>();
        const controllers: string[] = [];
        const play = jest
            .spyOn(radioRuntime, 'play')
            .mockImplementation(async (_client, server, controller) => {
                controllers.push(controller);
                const id = randomUUID();
                await db.voicePlayback.create({
                    data: {
                        id,
                        guildId: server,
                        channelId,
                        requesterId: memberId,
                        stationId: 'defcon',
                        state: 'PLAYING',
                    },
                });
                sessions.set(server, { id });
                return {
                    id,
                    channelId,
                    stationId: 'defcon',
                    player: 'playing',
                    connection: 'ready',
                    playbackMs: 0,
                } as Awaited<ReturnType<typeof radioRuntime.play>>;
            });
        const status = jest
            .spyOn(radioRuntime, 'status')
            .mockImplementation((server) => {
                const session = sessions.get(server);
                return session
                    ? ({
                          ...session,
                          channelId,
                          stationId: 'defcon',
                          player: 'playing',
                          connection: 'ready',
                          playbackMs: 0,
                      } as ReturnType<typeof radioRuntime.status>)
                    : null;
            });
        try {
            await addMember();
            await addMember();
            await startQueue(client, guildId, actorId);
            const first = sessions.get(guildId)!;
            sessions.delete(guildId);
            await db.voicePlayback.update({
                where: { id: first.id },
                data: {
                    state: 'STOPPED',
                    detail: 'Queue skip',
                    finishedAt: new Date(),
                },
            });

            await maintainQueues(client);

            expect(controllers).toEqual([actorId, actorId]);
            const second = sessions.get(guildId)!;
            sessions.delete(guildId);
            await db.voicePlayback.update({
                where: { id: second.id },
                data: {
                    state: 'STOPPED',
                    detail: 'Stopped by authorized member',
                    finishedAt: new Date(),
                },
            });
            await maintainQueues(client);
        } finally {
            play.mockRestore();
            status.mockRestore();
        }
    });
    it('does not enqueue with disabled settings or after bot removal', async () => {
        await moduleRegistry.configure(guildId, 'audio', true, {
            queuesEnabled: false,
        });
        await expect(add()).rejects.toThrow('Queues disabled');
        await db.guildInstallation.update({
            where: { guildId },
            data: { active: false },
        });
        await expect(add()).rejects.toThrow('Audio disabled');
    });
});
