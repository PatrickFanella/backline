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
    previewRestore,
    queueRestore,
    restoreApplyHandler,
    mapRecoveryResource,
} from '../../../src/recovery/restore';
import { captureSnapshot } from '../../../src/recovery/snapshots';
import { env } from '../../../src/utils/env';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('selective restore', () => {
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
        type: ChannelType.GuildText as ChannelType,
        parentId: null as string | null,
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
    const bot = {
        id: '777777777777777868',
        permissions: new PermissionsBitField([
            PermissionFlagsBits.ManageRoles,
            PermissionFlagsBits.ManageChannels,
        ]),
        roles: { highest: { position: 10 } },
    };
    const normalId = '777777777777777867',
        recreatedId = '777777777777777866';
    const normal = {
        ...role,
        id: normalId,
        name: 'Members',
        position: 1,
        permissions: new PermissionsBitField([
            PermissionFlagsBits.SendMessages,
        ]),
        editable: true,
        edit: jest.fn(),
    };
    const roleMap = new Map([
        [guildId, role],
        [normalId, normal],
    ]);
    const createRole = jest.fn(
        (values: {
            name: string;
            permissions: bigint;
            color: number;
            hoist: boolean;
            mentionable: boolean;
        }) => {
            const created = {
                ...normal,
                ...values,
                id: recreatedId,
                permissions: new PermissionsBitField(values.permissions),
            };
            roleMap.set(recreatedId, created);
            return Promise.resolve(created);
        }
    );
    const channelMap = new Map([[channelId, channel]]);
    let createdChannelCount = 0;
    const createChannel = jest.fn(
        (options: {
            name: string;
            type: ChannelType;
            parent?: string | null;
            permissionOverwrites: {
                id: string;
                type: number;
                allow: bigint;
                deny: bigint;
            }[];
        }) => {
            const id =
                ++createdChannelCount === 1
                    ? '777777777777777870'
                    : '777777777777777871';
            const created = {
                ...channel,
                id,
                name: options.name,
                type: options.type,
                parentId: options.parent ?? null,
                permissionOverwrites: {
                    cache: new Map(
                        options.permissionOverwrites.map((row) => [
                            row.id,
                            {
                                ...row,
                                allow: new PermissionsBitField(row.allow),
                                deny: new PermissionsBitField(row.deny),
                            },
                        ])
                    ),
                },
            };
            channelMap.set(id, created);
            return Promise.resolve(created);
        }
    );
    const guild = {
        id: guildId,
        name: 'Snapshot fixture',
        ownerId: actorId,
        members: {
            fetch: jest.fn().mockResolvedValue(actor),
            fetchMe: jest.fn().mockResolvedValue(bot),
        },
        roles: {
            fetch: jest.fn((id?: string) =>
                Promise.resolve(id ? roleMap.get(id) : roleMap)
            ),
            create: createRole,
        },
        channels: {
            fetch: jest.fn((id?: string) =>
                Promise.resolve(id ? channelMap.get(id) : channelMap)
            ),
            create: createChannel,
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
        guild.ownerId = actorId;
        channelMap.clear();
        channelMap.set(channelId, channel);
        createChannel.mockClear();
        createdChannelCount = 0;
        roleMap.clear();
        roleMap.set(guildId, role);
        roleMap.set(normalId, normal);
        channel.name = 'general';
        normal.name = 'Members';
        normal.permissions = new PermissionsBitField([
            PermissionFlagsBits.SendMessages,
        ]);
        normal.edit.mockReset().mockImplementation((values) => {
            Object.assign(normal, values, {
                permissions: new PermissionsBitField(
                    values.permissions as bigint
                ),
            });
            return Promise.resolve(normal);
        });
        createRole.mockClear();
        createRole.mockImplementation((values) => {
            const created = {
                ...normal,
                ...values,
                id: recreatedId,
                permissions: new PermissionsBitField(values.permissions),
            };
            roleMap.set(recreatedId, created);
            return Promise.resolve(created);
        });
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
        await db.restorePlan.deleteMany({ where: { guildId } });
        await db.recoveryMapping.deleteMany({ where: { guildId } });
        await db.serverSnapshot.deleteMany({ where: { guildId } });
        await db.guildModuleConfig.deleteMany({ where: { guildId } });
        await db.guildInstallation.deleteMany({ where: { guildId } });
    });
    afterAll(async () => {
        env.BOT_GUILD_IDS.splice(0, env.BOT_GUILD_IDS.length, ...priorGuilds);
        await db.$disconnect();
    });
    async function preview(requestId = 'preview') {
        const snapshot = await captureSnapshot(
            client,
            guildId,
            actorId,
            'source'
        );
        roleMap.delete(normalId);
        const plan = await previewRestore(
            client,
            guildId,
            actorId,
            snapshot.id,
            requestId,
            [normalId]
        );
        return { snapshot, plan };
    }
    async function queued() {
        const { plan } = await preview();
        const job = await queueRestore(
            client,
            guildId,
            actorId,
            plan.id,
            `RESTORE ${guildId} ${plan.id}`
        );
        return { plan, job, handler: restoreApplyHandler(client) };
    }
    it('compares and selects creation without modifying Discord', async () => {
        const { plan } = await preview();
        expect(
            (
                plan.operations as unknown as {
                    sourceId: string;
                    action: string;
                }[]
            ).find((op) => op.sourceId === normalId)?.action
        ).toBe('CREATE');
        expect(createRole).not.toHaveBeenCalled();
    });
    it('requires exact current owner confirmation and rejects stale previews', async () => {
        const { plan } = await preview();
        await expect(
            queueRestore(client, guildId, actorId, plan.id, 'yes')
        ).rejects.toThrow('Confirm');
        guild.ownerId = '777777777777777869';
        await expect(
            queueRestore(
                client,
                guildId,
                actorId,
                plan.id,
                `RESTORE ${guildId} ${plan.id}`
            )
        ).rejects.toThrow('owner');
        guild.ownerId = actorId;
        channelMap.clear();
        channelMap.set(channelId, channel);
        createChannel.mockClear();
        createdChannelCount = 0;
        channel.name = 'changed';
        await expect(
            queueRestore(
                client,
                guildId,
                actorId,
                plan.id,
                `RESTORE ${guildId} ${plan.id}`
            )
        ).rejects.toThrow('stale');
        expect(createRole).not.toHaveBeenCalled();
    });
    it('applies once through the worker and persists mappings and completed receipts', async () => {
        const { plan, job, handler } = await queued();
        await db.durableJob.update({
            where: { id: job.id },
            data: { runAt: new Date(Date.now() - 60000) },
        });
        const worker = new JobWorker(new Map([['restore-apply', handler]]));
        await Promise.all([worker.tick(), worker.tick()]);
        expect(createRole).toHaveBeenCalledTimes(1);
        expect(
            (await db.restorePlan.findUniqueOrThrow({ where: { id: plan.id } }))
                .state
        ).toBe('COMPLETED');
        expect(
            (
                await db.recoveryMapping.findFirstOrThrow({
                    where: { guildId, sourceId: normalId },
                })
            ).targetId
        ).toBe(recreatedId);
        expect((await restoreApplyHandler(client).reconcile(job)).state).toBe(
            'DELIVERED'
        );
    });
    it('pauses a confirmed rejection and safely resumes after explicit owner confirmation', async () => {
        const { plan, job, handler } = await queued();
        createRole.mockRejectedValueOnce({ status: 403 });
        expect((await handler.execute(job)).state).toBe('FAILED');
        expect(
            (await db.restorePlan.findUniqueOrThrow({ where: { id: plan.id } }))
                .state
        ).toBe('PAUSED');
        const resumed = await queueRestore(
            client,
            guildId,
            actorId,
            plan.id,
            `RESTORE ${guildId} ${plan.id}`
        );
        expect(resumed.id).not.toBe(job.id);
        expect((await handler.execute(resumed)).state).toBe('DELIVERED');
        expect(createRole).toHaveBeenCalledTimes(2);
    });
    it('holds uncertain creation and uses an owner mapping in a fresh preview', async () => {
        const { plan, job, handler } = await queued();
        createRole.mockImplementationOnce((values) => {
            roleMap.set(recreatedId, {
                ...normal,
                ...values,
                id: recreatedId,
                permissions: new PermissionsBitField(values.permissions),
            });
            return Promise.reject(new Error('lost result'));
        });
        expect((await handler.execute(job)).state).toBe('RECONCILE');
        expect((await handler.execute(job)).state).toBe('CANCELLED');
        expect(createRole).toHaveBeenCalledTimes(1);
        await expect(
            queueRestore(
                client,
                guildId,
                actorId,
                plan.id,
                `RESTORE ${guildId} ${plan.id}`
            )
        ).rejects.toThrow();
        await mapRecoveryResource(
            client,
            guildId,
            actorId,
            'role',
            normalId,
            recreatedId
        );
        const second = await previewRestore(
            client,
            guildId,
            actorId,
            plan.snapshotId,
            'new-preview',
            [normalId]
        );
        expect(
            (
                second.operations as unknown as {
                    sourceId: string;
                    action: string;
                }[]
            ).find((op) => op.sourceId === normalId)?.action
        ).toBe('UNCHANGED');
    });
    it('excludes protected roles from selected application', async () => {
        const snapshot = await captureSnapshot(
            client,
            guildId,
            actorId,
            'source'
        );
        roleMap.delete(normalId);
        await moduleRegistry.configure(guildId, 'recovery', true, {
            protectedRoleIds: [normalId],
        });
        const plan = await previewRestore(
            client,
            guildId,
            actorId,
            snapshot.id,
            'protected',
            [normalId]
        );
        expect(
            (
                plan.operations as unknown as {
                    sourceId: string;
                    action: string;
                }[]
            ).find((op) => op.sourceId === normalId)?.action
        ).toBe('SKIP');
        await expect(
            queueRestore(
                client,
                guildId,
                actorId,
                plan.id,
                `RESTORE ${guildId} ${plan.id}`
            )
        ).rejects.toThrow('no selected changes');
    });
    it('recreates parent and child with mapped role overwrites and preserved bot access', async () => {
        const categoryId = '777777777777777872',
            childId = '777777777777777873';
        channelMap.set(categoryId, {
            ...channel,
            id: categoryId,
            name: 'Category',
            type: ChannelType.GuildCategory,
        });
        channelMap.set(childId, {
            ...channel,
            id: childId,
            name: 'Child',
            parentId: categoryId,
            permissionOverwrites: {
                cache: new Map([
                    [
                        normalId,
                        {
                            id: normalId,
                            type: 0,
                            allow: new PermissionsBitField([
                                PermissionFlagsBits.ViewChannel,
                            ]),
                            deny: new PermissionsBitField([]),
                        },
                    ],
                ]),
            },
        });
        const snapshot = await captureSnapshot(
            client,
            guildId,
            actorId,
            'dependent-source'
        );
        roleMap.delete(normalId);
        channelMap.delete(categoryId);
        channelMap.delete(childId);
        const blocked = await previewRestore(
            client,
            guildId,
            actorId,
            snapshot.id,
            'blocked',
            [childId]
        );
        expect(
            (
                blocked.operations as unknown as {
                    sourceId: string;
                    action: string;
                }[]
            ).find((op) => op.sourceId === childId)?.action
        ).toBe('SKIP');
        const plan = await previewRestore(
            client,
            guildId,
            actorId,
            snapshot.id,
            'dependent',
            [normalId, categoryId, childId]
        );
        const job = await queueRestore(
            client,
            guildId,
            actorId,
            plan.id,
            `RESTORE ${guildId} ${plan.id}`
        );
        expect((await restoreApplyHandler(client).execute(job)).state).toBe(
            'DELIVERED'
        );
        expect(createRole).toHaveBeenCalledTimes(1);
        expect(createChannel).toHaveBeenCalledTimes(2);
        const child = createChannel.mock.calls[1][0];
        expect(child.parent).toBe('777777777777777870');
        expect(
            child.permissionOverwrites.some((row) => row.id === recreatedId)
        ).toBe(true);
        expect(
            child.permissionOverwrites.some(
                (row) =>
                    row.id === bot.id &&
                    !!(row.allow & PermissionFlagsBits.ManageChannels)
            )
        ).toBe(true);
    });
    it('updates an ordinary role only after owner-confirmed comparison', async () => {
        const snapshot = await captureSnapshot(
            client,
            guildId,
            actorId,
            'update-source'
        );
        normal.name = 'Changed';
        const plan = await previewRestore(
            client,
            guildId,
            actorId,
            snapshot.id,
            'update-role',
            [normalId]
        );
        const operation = (
            plan.operations as unknown as {
                sourceId: string;
                action: string;
                before: { name: string };
                after: { name: string };
            }[]
        ).find((op) => op.sourceId === normalId)!;
        expect(operation.action).toBe('UPDATE');
        expect(operation.before.name).toBe('Changed');
        expect(operation.after.name).toBe('Members');
        const job = await queueRestore(
            client,
            guildId,
            actorId,
            plan.id,
            `RESTORE ${guildId} ${plan.id}`
        );
        expect((await restoreApplyHandler(client).execute(job)).state).toBe(
            'DELIVERED'
        );
        expect(normal.edit).toHaveBeenCalledTimes(1);
        expect(normal.name).toBe('Members');
        expect(createRole).not.toHaveBeenCalled();
    });
});
