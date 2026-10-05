import { createHash } from 'node:crypto';

import { Client, PermissionFlagsBits, PermissionsBitField } from 'discord.js';

import {
    approvedClip,
    deleteClip,
    expireClips,
    saveSoundboard,
    storeClip,
} from '../../../src/audio/clips';
import { enqueueSoundboard, queueItems } from '../../../src/audio/queue';
import { db } from '../../../src/db';
import { moduleRegistry } from '../../../src/modules/registry';
import { env } from '../../../src/utils/env';
import { pcmWave } from '../../fixtures/pcmWave';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('approved audio storage and soundboards', () => {
    const guildId = '777777777777777831',
        otherGuild = '777777777777777832',
        actorId = '777777777777777833',
        channelId = '777777777777777834';
    let previous: string[], voice: boolean;
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
                                permissions: new PermissionsBitField([
                                    PermissionFlagsBits.ManageGuild,
                                ]),
                                roles: { cache: new Map() },
                            })
                        ),
                    },
                })
            ),
        },
    } as unknown as Client;
    const metadata = {
        title: 'Original clip',
        source: 'Backline fixture',
        license: 'Original recording',
        rights: 'original',
        confirmed: true,
    };
    beforeAll(() => {
        previous = [...env.BOT_GUILD_IDS];
        voice = env.BOT_VOICE_INTENT;
        env.BOT_GUILD_IDS.push(guildId, otherGuild);
        env.BOT_VOICE_INTENT = true;
    });
    beforeEach(async () => {
        for (const id of [guildId, otherGuild]) {
            await db.guildInstallation.create({
                data: { guildId: id, name: 'Clip fixture', active: true },
            });
            await moduleRegistry.configure(id, 'audio', true, {
                clipsEnabled: true,
                queuesEnabled: true,
            });
        }
    });
    afterEach(async () => {
        const where = { guildId: { in: [guildId, otherGuild] } };
        await db.audioSoundboard.deleteMany({ where });
        await db.audioQueue.deleteMany({ where });
        await db.audioClip.deleteMany({ where });
        await db.guildModuleConfig.deleteMany({ where });
        await db.guildInstallation.deleteMany({ where });
    });
    afterAll(async () => {
        env.BOT_GUILD_IDS.splice(0, env.BOT_GUILD_IDS.length, ...previous);
        env.BOT_VOICE_INTENT = voice;
        await db.$disconnect();
    });
    const add = (marker = 0, server = guildId) =>
        storeClip(server, actorId, pcmWave(0.1, marker), metadata);
    it('deduplicates simultaneous uploads and retains explicit approval metadata without returning bytes', async () => {
        const [a, b] = await Promise.all([add(), add()]);
        expect(a.id).toBe(b.id);
        expect(a).toMatchObject({
            approvedBy: actorId,
            durationMs: 100,
            source: metadata.source,
            rights: 'original',
        });
        expect(a).not.toHaveProperty('data');
        await expect(
            storeClip(guildId, actorId, pcmWave(), {
                ...metadata,
                confirmed: false,
            })
        ).rejects.toThrow();
        await expect(
            storeClip(guildId, actorId, Buffer.from('not audio'), metadata)
        ).rejects.toThrow();
    });
    it('rejects cross-server reads, withdrawal and soundboard references', async () => {
        const clip = await add();
        await expect(approvedClip(otherGuild, clip.id)).rejects.toThrow();
        expect((await deleteClip(otherGuild, clip.id)).count).toBe(0);
        await expect(
            saveSoundboard(otherGuild, actorId, {
                name: 'Other',
                clipIds: [clip.id],
            })
        ).rejects.toThrow();
        expect(await db.audioClip.count({ where: { guildId } })).toBe(1);
    });
    it('queues an entire board atomically and rejects stale references after withdrawal', async () => {
        const a = await add(),
            b = await add(1);
        await saveSoundboard(guildId, actorId, {
            name: 'Two',
            clipIds: [a.id, b.id],
        });
        await enqueueSoundboard(client, guildId, actorId, 'Two');
        expect(
            queueItems
                .parse(
                    (
                        await db.audioQueue.findUniqueOrThrow({
                            where: { guildId },
                        })
                    ).items
                )
                .map((i) => i.clipId)
        ).toEqual([a.id, b.id]);
        await deleteClip(guildId, a.id);
        await expect(
            enqueueSoundboard(client, guildId, actorId, 'Two')
        ).rejects.toThrow('withdrawn');
        expect(
            queueItems.parse(
                (await db.audioQueue.findUniqueOrThrow({ where: { guildId } }))
                    .items
            )
        ).toHaveLength(2);
    });
    it('enforces the clip count quota under concurrent uploads', async () => {
        const data = pcmWave(0.05);
        await db.audioClip.createMany({
            data: Array.from({ length: 99 }, (_, i) => ({
                guildId,
                title: 'Seed',
                data: new Uint8Array(data),
                byteSize: data.length,
                durationMs: 50,
                sha256: `fixture-${i}`,
                source: 'Fixture',
                license: 'Original',
                rights: 'original',
                approvedBy: actorId,
            })),
        });
        const results = await Promise.allSettled([add(2), add(3)]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(await db.audioClip.count({ where: { guildId } })).toBe(100);
    });
    it('enforces fifty MiB even below the clip count limit', async () => {
        const data = pcmWave(15, 0, 2);
        await db.audioClip.createMany({
            data: Array.from({ length: 18 }, (_, i) => ({
                guildId,
                title: 'Seed',
                data: new Uint8Array(data),
                byteSize: data.length,
                durationMs: 15000,
                sha256: `large-${i}`,
                source: 'Fixture',
                license: 'Original',
                rights: 'original',
                approvedBy: actorId,
            })),
        });
        await expect(
            storeClip(guildId, actorId, pcmWave(15, 1, 2), metadata)
        ).rejects.toThrow('quota');
        expect(await db.audioClip.count({ where: { guildId } })).toBe(18);
    });
    it('withdraws disabled clips and expires unused bytes while retaining recently used clips', async () => {
        const a = await add(),
            b = await add(1),
            before = new Date(Date.now() - 91 * 86400000);
        await db.audioClip.updateMany({
            where: { guildId },
            data: { createdAt: before },
        });
        const read = await approvedClip(guildId, b.id);
        expect(createHash('sha256').update(read.data).digest('hex')).toBe(
            read.sha256
        );
        await expireClips();
        expect(
            await db.audioClip.findUnique({ where: { id: a.id } })
        ).toBeNull();
        expect(await db.audioClip.count({ where: { id: b.id } })).toBe(1);
        await moduleRegistry.configure(guildId, 'audio', false, {
            clipsEnabled: false,
        });
        await expect(approvedClip(guildId, b.id)).rejects.toThrow('disabled');
        expect((await deleteClip(guildId, b.id)).count).toBe(1);
    });
});
