import { createHash, randomUUID } from 'crypto';

import { Prisma } from '@prisma/client';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    Client,
    Interaction,
    MessageReaction,
    PartialMessageReaction,
    PartialUser,
    PermissionFlagsBits,
    User,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
} from 'discord.js';
import { z } from 'zod';

import { db } from '../db';
import { moduleRegistry } from '../modules/registry';

import { selfRolesConfig } from './config';
import { assertAssignableRole } from './roles';

type Config = z.infer<typeof selfRolesConfig>;
export function roleConfigHash(config: Config) {
    return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}
export function planRoleChoice(
    config: Config,
    current: Set<string>,
    selection: { toggle?: string; selected?: string[] }
) {
    const managed = new Set(config.roles.map((role) => role.roleId));
    if (selection.toggle && !managed.has(selection.toggle))
        throw new Error('Role is not offered');
    if (selection.selected?.some((id) => !managed.has(id)))
        throw new Error('Role is not offered');
    const result = new Set(current);
    if (selection.selected) {
        for (const id of managed) result.delete(id);
        for (const id of selection.selected) result.add(id);
    } else if (selection.toggle) {
        if (result.has(selection.toggle)) result.delete(selection.toggle);
        else {
            const target = config.roles.find(
                (role) => role.roleId === selection.toggle
            )!;
            if (target.group)
                for (const role of config.roles)
                    if (role.group === target.group) result.delete(role.roleId);
            result.add(target.roleId);
        }
    } else throw new Error('No role selection');
    const groups = new Set<string>();
    for (const role of config.roles)
        if (result.has(role.roleId)) {
            if (role.requires.some((id) => !result.has(id)))
                throw new Error('Required roles unavailable');
            if (role.group && groups.has(role.group))
                throw new Error(
                    'Choose only one role from each exclusive group'
                );
            if (role.group) groups.add(role.group);
        }
    return {
        add: [...result].filter((id) => !current.has(id)),
        remove: [...current].filter((id) => !result.has(id) && managed.has(id)),
    };
}
async function settings(guildId: string) {
    if (!(await moduleRegistry.enabled(guildId, 'self-roles')))
        throw new Error('Self-service roles disabled');
    const row = await db.guildModuleConfig.findUniqueOrThrow({
        where: { guildId_moduleId: { guildId, moduleId: 'self-roles' } },
    });
    return selfRolesConfig.parse(row.config);
}
export async function applyRoleChoice(
    client: Client,
    guildId: string,
    userId: string,
    requestId: string,
    panelId: string,
    messageId: string,
    selection: { toggle?: string; selected?: string[] }
) {
    const reserved = await db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId + ':' + userId})::bigint)::text`
        );
        const existing = await tx.roleChoice.findUnique({
            where: { guildId_requestId: { guildId, requestId } },
        });
        if (existing) return { record: existing, fresh: false };
        if (
            await tx.roleChoiceLock.findUnique({
                where: { guildId_userId: { guildId, userId } },
            })
        )
            throw new Error(
                'A previous role action is pending or requires review'
            );
        const record = await tx.roleChoice.create({
            data: { guildId, userId, requestId },
        });
        await tx.roleChoiceLock.create({
            data: { guildId, userId, actionId: record.id },
        });
        return { record, fresh: true };
    });
    if (!reserved.fresh) return reserved.record;
    let mutationStarted = false;
    try {
        const config = await settings(guildId);
        const panel = await db.rolePanel.findFirst({
            where: {
                id: panelId,
                guildId,
                messageId,
                state: 'DELIVERED',
                configHash: roleConfigHash(config),
            },
        });
        if (!panel)
            throw new Error(
                'Panel expired; ask a manager to publish the current panel'
            );
        const guild = await client.guilds.fetch({
            guild: guildId,
            force: true,
        });
        const member = await guild.members.fetch({ user: userId, force: true });
        const bot = await guild.members.fetchMe({ force: true });
        const plan = planRoleChoice(
            config,
            new Set(member.roles.cache.keys()),
            selection
        );
        for (const id of [...plan.add, ...plan.remove]) {
            const role = await guild.roles.fetch(id, { force: true });
            if (!role) throw new Error('Role unavailable');
            assertAssignableRole(guild, bot, role);
        }
        for (const id of plan.remove) {
            mutationStarted = true;
            await member.roles.remove(id, 'Backline self-service role choice');
        }
        for (const id of plan.add) {
            mutationStarted = true;
            await member.roles.add(id, 'Backline self-service role choice');
        }
        const current = await guild.members.fetch({
            user: userId,
            force: true,
        });
        if (
            plan.add.some((id) => !current.roles.cache.has(id)) ||
            plan.remove.some((id) => current.roles.cache.has(id))
        )
            throw new Error('Role readback did not match');
        // Also check prerequisites after external role changes during delivery.
        planRoleChoice(config, new Set(current.roles.cache.keys()), {
            selected: config.roles
                .filter((role) => current.roles.cache.has(role.roleId))
                .map((role) => role.roleId),
        });
        return await db.$transaction(async (tx) => {
            const record = await tx.roleChoice.update({
                where: { id: reserved.record.id },
                data: {
                    state: 'DELIVERED',
                    outcome: { added: plan.add, removed: plan.remove },
                },
            });
            await tx.roleChoiceLock.deleteMany({
                where: { actionId: record.id },
            });
            return record;
        });
    } catch {
        const record = await db.roleChoice.update({
            where: { id: reserved.record.id },
            data: {
                state: mutationStarted ? 'UNCERTAIN' : 'DENIED',
                detail: mutationStarted
                    ? 'Role outcome requires investigation; further choices are held'
                    : 'Current panel, role eligibility or prerequisites denied',
            },
        });
        if (!mutationStarted)
            await db.roleChoiceLock.deleteMany({
                where: { actionId: record.id },
            });
        return record;
    }
}
export const rolePanelCommand = new SlashCommandBuilder()
    .setName('roles-panel')
    .setDescription('Publish the configured self-service role panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setContexts(0)
    .setIntegrationTypes(0)
    .toJSON();
export async function publishRolePanel(
    interaction: ChatInputCommandInteraction
): Promise<void> {
    const guild = interaction.guild!;
    const actor = await guild.members.fetch({
        user: interaction.user.id,
        force: true,
    });
    if (!actor.permissions.has(PermissionFlagsBits.ManageRoles))
        throw new Error('Current Manage Roles permission required');
    const config = await settings(guild.id);
    if (!config.channelId || !config.roles.length)
        throw new Error('Configure a destination and roles first');
    const bot = await guild.members.fetchMe({ force: true });
    for (const option of config.roles) {
        const role = await guild.roles.fetch(option.roleId, { force: true });
        if (!role) throw new Error('Role unavailable');
        assertAssignableRole(guild, bot, role);
    }
    const channel = await guild.channels.fetch(config.channelId);
    if (!channel || !channel.isTextBased() || !('send' in channel))
        throw new Error('Panel channel unavailable');
    if (
        config.style === 'reactions' &&
        !channel
            .permissionsFor(bot)
            ?.has([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.AddReactions,
                PermissionFlagsBits.ReadMessageHistory,
            ])
    )
        throw new Error('Bot reaction panel permissions unavailable');
    const configHash = roleConfigHash(config);
    const panel = await db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guild.id})::bigint)::text`
        );
        const existing = await tx.rolePanel.findUnique({
            where: { guildId_configHash: { guildId: guild.id, configHash } },
        });
        return (
            existing ??
            tx.rolePanel.create({
                data: { guildId: guild.id, configHash, channelId: channel.id },
            })
        );
    });
    if (panel.state === 'DELIVERED') {
        await interaction.editReply(
            `Panel already published: ${panel.messageId}. Configuration changes require publishing a new panel.`
        );
        return;
    }
    const claimed = await db.rolePanel.updateMany({
        where: { id: panel.id, state: 'PENDING' },
        data: { state: 'SENDING' },
    });
    if (!claimed.count) throw new Error('Panel send pending or uncertain');
    const components: (
        | ActionRowBuilder<ButtonBuilder>
        | ActionRowBuilder<StringSelectMenuBuilder>
    )[] = [];
    if (config.style === 'select')
        components.push(
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`backline:role-select:${panel.id}`)
                    .setPlaceholder(
                        'Choose roles; unselected offered roles are removed'
                    )
                    .setMinValues(0)
                    .setMaxValues(config.roles.length)
                    .addOptions(
                        config.roles.map((option) => ({
                            label: option.label,
                            value: option.roleId,
                        }))
                    )
            )
        );
    else
        for (let offset = 0; offset < config.roles.length; offset += 5)
            components.push(
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    config.roles
                        .slice(offset, offset + 5)
                        .map((option) =>
                            new ButtonBuilder()
                                .setCustomId(
                                    `backline:role:${panel.id}:${option.roleId}`
                                )
                                .setLabel(option.label)
                                .setStyle(ButtonStyle.Secondary)
                        )
                )
            );
    try {
        const message = await channel.send({
            content: config.title,
            components,
            allowedMentions: { parse: [] },
            nonce: panel.id.replace(/-/g, '').slice(0, 24),
            enforceNonce: true,
        });
        if (config.style === 'reactions')
            for (const option of config.roles)
                await message.react(option.emoji!);
        await db.rolePanel.update({
            where: { id: panel.id },
            data: { state: 'DELIVERED', messageId: message.id },
        });
        await interaction.editReply(`Role panel published: ${message.id}.`);
    } catch {
        await db.rolePanel.update({
            where: { id: panel.id },
            data: { state: 'UNCERTAIN' },
        });
        throw new Error('Panel outcome uncertain');
    }
}

/** Apply a reaction panel's current desired managed-role set, never a blind toggle. */
export async function applySelfRoleReaction(
    client: Client,
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
    added: boolean
): Promise<void> {
    if (user.partial) user = await user.fetch();
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    const guildId = reaction.message.guildId;
    if (!guildId) return;
    const panel = await db.rolePanel.findFirst({
        where: {
            guildId,
            messageId: reaction.message.id,
            state: 'DELIVERED',
        },
    });
    if (!panel) return;
    const config = await settings(guildId);
    if (
        config.style !== 'reactions' ||
        panel.configHash !== roleConfigHash(config)
    )
        return;
    const emoji = reaction.emoji.name;
    const option = config.roles.find((role) => role.emoji === emoji);
    if (!option) return;
    const guild = await client.guilds.fetch({ guild: guildId, force: true });
    const member = await guild.members.fetch({ user: user.id, force: true });
    if (member.user.bot) return;
    const selected = new Set(
        config.roles
            .filter((role) => member.roles.cache.has(role.roleId))
            .map((role) => role.roleId)
    );
    if (added) {
        if (option.group)
            for (const role of config.roles)
                if (role.group === option.group) selected.delete(role.roleId);
        selected.add(option.roleId);
    } else selected.delete(option.roleId);
    // Discord events do not provide a durable event id. Each delivery needs a
    // new receipt so a later add after a remove cannot reuse an older add.
    // The desired current state still makes duplicate gateway deliveries no-ops.
    const requestId = `reaction:${added ? 'add' : 'remove'}:${randomUUID()}`;
    await applyRoleChoice(
        client,
        guildId,
        user.id,
        requestId,
        panel.id,
        reaction.message.id,
        { selected: [...selected] }
    );
}
export async function routeSelfRoles(
    interaction: Interaction
): Promise<boolean> {
    if (
        interaction.isChatInputCommand() &&
        interaction.commandName === 'roles-panel'
    ) {
        await publishRolePanel(interaction);
        return true;
    }
    if (
        !interaction.isMessageComponent() ||
        !interaction.customId.startsWith('backline:role')
    )
        return false;
    let panelId: string, selection: { toggle?: string; selected?: string[] };
    if (
        interaction.isButton() &&
        interaction.customId.startsWith('backline:role:')
    ) {
        const parts = interaction.customId.split(':');
        panelId = parts[2];
        selection = { toggle: parts[3] };
    } else if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith('backline:role-select:')
    ) {
        panelId = interaction.customId.slice('backline:role-select:'.length);
        selection = { selected: interaction.values };
    } else return false;
    const result = await applyRoleChoice(
        interaction.client,
        interaction.guildId!,
        interaction.user.id,
        interaction.id,
        panelId,
        interaction.message.id,
        selection
    );
    await interaction.editReply(
        `Role choice: ${result.state}${result.detail ? ' — ' + result.detail : ''}`
    );
    return true;
}

export async function expireRoleChoices(): Promise<void> {
    await db.$executeRaw`DELETE FROM "RoleChoice" WHERE "createdAt" < NOW() - INTERVAL '90 days' AND "state" IN ('DELIVERED','DENIED') AND NOT EXISTS (SELECT 1 FROM "RoleChoiceLock" WHERE "actionId" = "RoleChoice"."id")`;
}
