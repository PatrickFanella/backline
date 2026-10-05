import {
    ChannelType,
    Client,
    PermissionsBitField,
    PermissionFlagsBits,
} from 'discord.js';

import { db } from '../../../src/db';
import { JobWorker } from '../../../src/jobs/store';
import { moduleRegistry } from '../../../src/modules/registry';
import {
    captureSnapshot,
    exportSnapshot,
    maintainSnapshots,
    snapshotCaptureHandler,
} from '../../../src/recovery/snapshots';
import { env } from '../../../src/utils/env';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('server snapshots', () => {
    const guildId = '777777777777777861',
        actorId = '777777777777777863',
        channelId = '777777777777777864';
    const actor = {
        id: actorId,
        user: { bot: false },
        permissions: new PermissionsBitField([PermissionFlagsBits.ManageGuild]),
    };
    const role = {
        id: guildId,
        name: '@everyone',
        color: 0,
        permissions: new PermissionsBitField([PermissionFlagsBits.ViewChannel]),
        position: 0,
        managed: false,
        hoist: false,
        mentionable: false,
    };
    const channel = {
        id: channelId,
        name: 'general',
        type: ChannelType.GuildText,
        parentId: null,
        rawPosition: 0,
        topic: 'A topic',
        permissionOverwrites: {
            cache: new Map([
                [
                    guildId,
                    {
                        id: guildId,
                        type: 0,
                        allow: new PermissionsBitField([
                            PermissionFlagsBits.ViewChannel,
                        ]),
                        deny: new PermissionsBitField([]),
                    },
                ],
            ]),
        },
    };
    const guild = {
        id: guildId,
        name: 'Snapshot fixture',
        members: { fetch: jest.fn().mockResolvedValue(actor) },
        roles: {
            fetch: jest.fn().mockResolvedValue(new Map([[guildId, role]])),
        },
        channels: {
            fetch: jest.fn().mockResolvedValue(new Map([[channelId, channel]])),
        },
    };
    const client = {
        guilds: { fetch: jest.fn().mockResolvedValue(guild) },
    } as unknown as Client;
    let priorGuilds: string[];
    beforeAll(() => {
        priorGuilds = [...env.BOT_GUILD_IDS];
        env.BOT_GUILD_IDS.push(guildId);
    });
    beforeEach(async () => {
        actor.permissions = new PermissionsBitField([
            PermissionFlagsBits.ManageGuild,
        ]);
        await db.guildInstallation.create({
            data: { guildId, name: guild.name, active: true },
        });
        await moduleRegistry.configure(guildId, 'recovery', true, {});
    });
    afterEach(async () => {
        await db.jobAttempt.deleteMany({ where: { job: { guildId } } });
        await db.durableJob.deleteMany({ where: { guildId } });
        await db.serverSnapshot.deleteMany({ where: { guildId } });
        await db.guildModuleConfig.deleteMany({ where: { guildId } });
        await db.guildInstallation.deleteMany({ where: { guildId } });
    });
    afterAll(async () => {
        env.BOT_GUILD_IDS.splice(0, env.BOT_GUILD_IDS.length, ...priorGuilds);
        await db.$disconnect();
    });
    it('captures roles/channels/overwrites once for duplicate requests', async () => {
        const rows = await Promise.all([
            captureSnapshot(client, guildId, actorId, 'same'),
            captureSnapshot(client, guildId, actorId, 'same'),
        ]);
        expect(rows[0].id).toBe(rows[1].id);
        const exported = await exportSnapshot(guildId, rows[0].id);
        expect(exported.manifest.version).toBe(1);
        expect(exported.manifest.roles[0].permissions).toBe(
            PermissionFlagsBits.ViewChannel.toString()
        );
        expect(exported.manifest.channels[0].overwrites).toHaveLength(1);
    });
    it('rejects corrupt manifests and cross-server exports', async () => {
        const row = await captureSnapshot(client, guildId, actorId, 'fixture');
        await expect(
            exportSnapshot('777777777777777862', row.id)
        ).rejects.toThrow();
        await db.serverSnapshot.update({
            where: { id: row.id },
            data: { checksum: 'corrupt' },
        });
        await expect(exportSnapshot(guildId, row.id)).rejects.toThrow(
            'checksum'
        );
    });
    it('enforces manager permission and disabled modules', async () => {
        actor.permissions = new PermissionsBitField([]);
        await expect(
            captureSnapshot(client, guildId, actorId, 'fixture')
        ).rejects.toThrow();
        await moduleRegistry.configure(guildId, 'recovery', false, {});
        await expect(
            captureSnapshot(client, guildId, null, 'scheduled', 'SCHEDULED')
        ).rejects.toThrow();
    });
    it('keeps at most ten snapshots and five templates', async () => {
        for (let i = 0; i < 5; i++)
            await captureSnapshot(
                client,
                guildId,
                actorId,
                'template:' + i,
                'TEMPLATE'
            );
        await expect(
            captureSnapshot(client, guildId, actorId, 'sixth', 'TEMPLATE')
        ).rejects.toThrow('Template capacity');
        for (let i = 0; i < 7; i++)
            await captureSnapshot(client, guildId, actorId, 'manual:' + i);
        expect(await db.serverSnapshot.count({ where: { guildId } })).toBe(10);
        expect(
            await db.serverSnapshot.count({
                where: { guildId, kind: 'TEMPLATE' },
            })
        ).toBe(5);
    });
    it('reserves scheduled captures once and survives worker recreation', async () => {
        await moduleRegistry.configure(guildId, 'recovery', true, {
            scheduled: true,
        });
        await Promise.all([maintainSnapshots(), maintainSnapshots()]);
        expect(await db.durableJob.count({ where: { guildId } })).toBe(1);
        await db.durableJob.updateMany({
            where: { guildId },
            data: { runAt: new Date(Date.now() - 60000) },
        });
        const worker = new JobWorker(
            new Map([['snapshot-capture', snapshotCaptureHandler(client)]])
        );
        await worker.tick();
        expect(
            await db.serverSnapshot.count({
                where: { guildId, kind: 'SCHEDULED' },
            })
        ).toBe(1);
        const job = await db.durableJob.findFirstOrThrow({
            where: { guildId },
        });
        expect(job.state).toBe('DELIVERED');
        expect(
            (await snapshotCaptureHandler(client).reconcile(job)).state
        ).toBe('DELIVERED');
    });
    it('expires snapshots without touching other server records', async () => {
        const row = await captureSnapshot(client, guildId, actorId, 'fixture');
        await db.serverSnapshot.update({
            where: { id: row.id },
            data: { expiresAt: new Date(Date.now() - 1000) },
        });
        await maintainSnapshots();
        expect(await db.serverSnapshot.count({ where: { guildId } })).toBe(0);
        expect(await db.guildInstallation.count({ where: { guildId } })).toBe(
            1
        );
    });
});
