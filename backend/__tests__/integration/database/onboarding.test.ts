import {
    Client,
    GuildMember,
    Collection,
    PermissionFlagsBits,
    Interaction,
} from 'discord.js';

import {
    acknowledgeRules,
    captureJoin,
    onboardingHandler,
} from '../../../src/community/onboarding';
import { db } from '../../../src/db';
import { moduleRegistry } from '../../../src/modules/registry';
import { env } from '../../../src/utils/env';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('member onboarding episodes', () => {
    const guildId = '444444444444444444',
        userId = '555555555555555555',
        channelId = '666666666666666666',
        roleId = '777777777777777777';
    const role = {
        id: roleId,
        guild: { id: guildId },
        managed: false,
        permissions: { bitfield: BigInt(0) },
    };
    const bot = {
        permissions: { has: () => true },
        roles: { highest: { comparePositionTo: () => 1 } },
    };
    const member = {
        id: userId,
        joinedTimestamp: 1000,
        user: { username: 'member' },
        guild: { id: guildId },
        roles: { cache: new Collection(), add: jest.fn() },
    };
    const channel = { isTextBased: () => true, send: jest.fn() };
    const guild = {
        id: guildId,
        name: 'Fixture',
        members: { fetch: jest.fn(), fetchMe: jest.fn() },
        roles: { fetch: jest.fn() },
        channels: { fetch: jest.fn() },
    };
    const client = { guilds: { fetch: jest.fn() } };
    beforeEach(async () => {
        env.BOT_GUILD_IDS.push(guildId);
        env.BOT_MEMBER_INTENTS = true;
        await db.guildInstallation.upsert({
            where: { guildId },
            create: { guildId, name: 'fixture', active: true },
            update: { active: true },
        });
        await moduleRegistry.configure(guildId, 'onboarding', true, {
            channelId,
            joinRoles: [roleId],
        });
        member.joinedTimestamp = 1000;
        role.permissions.bitfield = BigInt(0);
        member.roles.add.mockResolvedValue(member);
        client.guilds.fetch.mockResolvedValue(guild);
        guild.members.fetch.mockResolvedValue(member);
        guild.members.fetchMe.mockResolvedValue(bot);
        guild.roles.fetch.mockResolvedValue(role);
        guild.channels.fetch.mockResolvedValue(channel);
        channel.send.mockResolvedValue({ id: 'welcome-id' });
    });
    afterEach(async () => {
        env.BOT_GUILD_IDS.splice(env.BOT_GUILD_IDS.indexOf(guildId), 1);
        env.BOT_MEMBER_INTENTS = false;
        const jobs = await db.durableJob.findMany({
            where: { guildId },
            select: { id: true },
        });
        await db.jobAttempt.deleteMany({
            where: { jobId: { in: jobs.map((job) => job.id) } },
        });
        await db.durableJob.deleteMany({ where: { guildId } });
        await db.memberJourney.deleteMany({ where: { guildId } });
        await db.guildModuleConfig.deleteMany({ where: { guildId } });
        await db.guildInstallation.delete({ where: { guildId } });
        jest.clearAllMocks();
    });
    afterAll(async () => {
        await db.$disconnect();
    });
    async function joined() {
        await captureJoin(member as unknown as GuildMember);
        return db.durableJob.findFirstOrThrow({
            where: { guildId, kind: 'onboarding-join' },
        });
    }
    it('deduplicates repeated joins and welcome delivery', async () => {
        await Promise.all(
            Array.from({ length: 3 }, () =>
                captureJoin(member as unknown as GuildMember)
            )
        );
        expect(await db.memberJourney.count({ where: { guildId } })).toBe(1);
        expect(await db.durableJob.count({ where: { guildId } })).toBe(1);
        const job = await db.durableJob.findFirstOrThrow({
            where: { guildId },
        });
        const handler = onboardingHandler(client as unknown as Client, 'join');
        expect(await handler.execute(job)).toMatchObject({
            state: 'DELIVERED',
            result: { messageId: 'welcome-id' },
        });
        await handler.execute(job);
        expect(channel.send).toHaveBeenCalledTimes(1);
        expect(member.roles.add).toHaveBeenCalledTimes(1);
    });
    it('holds a stale membership episode without assigning roles or welcoming', async () => {
        const job = await joined();
        member.joinedTimestamp = 2000;
        await expect(
            onboardingHandler(client as unknown as Client, 'join').execute(job)
        ).rejects.toThrow('Membership episode changed');
        expect(member.roles.add).not.toHaveBeenCalled();
        expect(channel.send).not.toHaveBeenCalled();
    });
    it('diagnoses privileged roles without assigning them', async () => {
        const job = await joined();
        role.permissions.bitfield = PermissionFlagsBits.ManageRoles;
        await onboardingHandler(client as unknown as Client, 'join').execute(
            job
        );
        expect(member.roles.add).not.toHaveBeenCalled();
        expect(
            (await db.memberJourney.findFirstOrThrow({ where: { guildId } }))
                .rolesState
        ).toBe('FAILED');
    });
    it('waits for member-bound rules acknowledgment and rejects another user or changed rules', async () => {
        await moduleRegistry.configure(guildId, 'onboarding', true, {
            channelId,
            joinRoles: [roleId],
            requireRules: true,
            rules: 'Be kind.',
        });
        const job = await joined();
        await onboardingHandler(client as unknown as Client, 'join').execute(
            job
        );
        const record = await db.memberJourney.findFirstOrThrow({
            where: { guildId },
        });
        expect(record.rolesState).toBe('WAITING');
        expect(member.roles.add).not.toHaveBeenCalled();
        const interaction = {
            isButton: () => true,
            customId: 'backline:rules:' + record.id,
            guildId,
            user: { id: 'other' },
            message: { id: 'welcome-id' },
            client,
            editReply: jest.fn(),
        };
        await acknowledgeRules(interaction as unknown as Interaction);
        expect(
            await db.durableJob.count({
                where: { guildId, kind: 'onboarding-roles' },
            })
        ).toBe(0);
        interaction.user.id = userId;
        await acknowledgeRules(interaction as unknown as Interaction);
        const roleJob = await db.durableJob.findFirstOrThrow({
            where: { guildId, kind: 'onboarding-roles' },
        });
        expect(
            await onboardingHandler(
                client as unknown as Client,
                'roles'
            ).execute(roleJob)
        ).toMatchObject({ state: 'DELIVERED' });
        expect(member.roles.add).toHaveBeenCalledTimes(1);
        await moduleRegistry.configure(guildId, 'onboarding', true, {
            channelId,
            joinRoles: [roleId],
            requireRules: true,
            rules: 'Updated rules.',
        });
        await acknowledgeRules(interaction as unknown as Interaction);
        expect(interaction.editReply).toHaveBeenLastCalledWith(
            expect.stringContaining('unavailable')
        );
    });
    it('holds an uncertain welcome response without sending again', async () => {
        const job = await joined();
        channel.send.mockRejectedValueOnce(new Error('lost'));
        const handler = onboardingHandler(client as unknown as Client, 'join');
        expect(await handler.execute(job)).toMatchObject({
            state: 'RECONCILE',
        });
        expect(await handler.execute(job)).toMatchObject({
            state: 'RECONCILE',
        });
        expect(channel.send).toHaveBeenCalledTimes(1);
    });
});
