import { Prisma, SupportTicket } from '@prisma/client';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Client,
    Guild,
    GuildMember,
    Interaction,
    OverwriteType,
    PermissionFlagsBits,
    SlashCommandBuilder,
    TextChannel,
} from 'discord.js';

import { db } from '../db';
import { moduleRegistry } from '../modules/registry';
import { env } from '../utils/env';
import { toInputJson } from '../utils/prismaJson';

import { id, ticketConfig } from './config';

const visible = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
];
const strings = (value: Prisma.JsonValue): string[] =>
    Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : [];
async function settings(guildId: string) {
    if (!(await moduleRegistry.enabled(guildId, 'tickets')))
        throw new Error('Tickets disabled');
    const row = await db.guildModuleConfig.findUniqueOrThrow({
        where: { guildId_moduleId: { guildId, moduleId: 'tickets' } },
    });
    return ticketConfig.parse(row.config);
}
export function ticketStaff(
    guild: Pick<Guild, 'ownerId'>,
    member: GuildMember,
    roles: string[]
) {
    return (
        member.id === guild.ownerId ||
        member.permissions.has(PermissionFlagsBits.Administrator) ||
        roles.some((role) => member.roles.cache.has(role))
    );
}
export function ticketOverwrites(
    guildId: string,
    botId: string,
    participants: string[],
    roles: string[],
    closed = false
) {
    return [
        {
            id: guildId,
            type: OverwriteType.Role,
            deny: [PermissionFlagsBits.ViewChannel],
        },
        ...roles.map((roleId) => ({
            id: roleId,
            type: OverwriteType.Role,
            allow: visible,
        })),
        ...participants
            .filter((userId) => userId !== botId)
            .map((userId) => ({
                id: userId,
                type: OverwriteType.Member,
                allow: visible.filter(
                    (bit) => !closed || bit !== PermissionFlagsBits.SendMessages
                ),
                deny: closed ? [PermissionFlagsBits.SendMessages] : [],
            })),
        {
            id: botId,
            type: OverwriteType.Member,
            allow: [
                ...visible,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageRoles,
            ],
        },
    ];
}
async function context(client: Client, guildId: string, actorId: string) {
    const config = await settings(guildId);
    const guild = await client.guilds.fetch({ guild: guildId, force: true });
    const actor = await guild.members.fetch({ user: actorId, force: true });
    const bot = await guild.members.fetchMe({ force: true });
    return { config, guild, actor, bot };
}
async function finish(
    ticket: SupportTicket,
    actionId: string,
    data: Prisma.SupportTicketUpdateInput = {}
) {
    return db.$transaction(async (tx) => {
        await tx.ticketAction.update({
            where: { id: actionId },
            data: { state: 'DELIVERED' },
        });
        return tx.supportTicket.update({
            where: { id: ticket.id },
            data: { ...data, heldActionId: null },
        });
    });
}
async function failed(
    ticket: SupportTicket,
    actionId: string,
    started: boolean
) {
    await db.ticketAction.update({
        where: { id: actionId },
        data: {
            state: started ? 'UNCERTAIN' : 'DENIED',
            detail: started
                ? 'Discord outcome held for investigation'
                : 'Current policy or permissions denied',
        },
    });
    if (!started)
        await db.supportTicket.update({
            where: { id: ticket.id },
            data: {
                heldActionId: null,
                ...(ticket.state === 'CREATING' ? { state: 'FAILED' } : {}),
            },
        });
}
export async function openTicket(
    client: Client,
    guildId: string,
    actorId: string,
    requestId: string
) {
    id.parse(actorId);
    const { config, guild, actor, bot } = await context(
        client,
        guildId,
        actorId
    );
    if (!config.staffRoles.length)
        throw new Error('Configure staff roles first');
    if (config.staffRoles.includes(guildId))
        throw new Error('Everyone cannot be ticket staff');
    for (const roleId of config.staffRoles)
        if (!(await guild.roles.fetch(roleId, { force: true })))
            throw new Error('Staff role unavailable');
    if (
        !bot.permissions.has([
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageRoles,
            ...visible,
        ])
    )
        throw new Error('Bot ticket permissions unavailable');
    if (config.categoryId) {
        const parent = await guild.channels.fetch(config.categoryId);
        if (
            !parent ||
            parent.type !== ChannelType.GuildCategory ||
            !parent.permissionsFor(bot)?.has(PermissionFlagsBits.ManageChannels)
        )
            throw new Error('Ticket category unavailable');
    }
    const reserved = await db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
        );
        const prior = await tx.ticketAction.findUnique({
            where: { guildId_requestId: { guildId, requestId } },
        });
        if (prior) {
            if (prior.actorId !== actorId || prior.kind !== 'open')
                throw new Error('Request mismatch');
            return {
                ticket: await tx.supportTicket.findUniqueOrThrow({
                    where: { id: prior.ticketId },
                }),
                action: prior,
                fresh: false,
            };
        }
        const current = await tx.guildModuleConfig.findUniqueOrThrow({
            where: { guildId_moduleId: { guildId, moduleId: 'tickets' } },
        });
        if (
            !current.enabled ||
            JSON.stringify(ticketConfig.parse(current.config)) !==
                JSON.stringify(config)
        )
            throw new Error('Ticket settings changed');
        const activeStates = ['CREATING', 'OPEN', 'CLOSED'];
        const existing = await tx.supportTicket.findFirst({
            where: {
                guildId,
                openerId: actorId,
                state: { in: ['CREATING', 'OPEN'] },
            },
        });
        if (existing) return { ticket: existing, action: null, fresh: false };
        if (
            (await tx.supportTicket.count({
                where: { guildId, state: { in: activeStates } },
            })) >= config.maxOpen
        )
            throw new Error(
                'Ticket capacity reached; expire closed tickets first'
            );
        if ((await tx.supportTicket.count({ where: { guildId } })) >= 1000)
            throw new Error('Ticket history capacity reached');
        const ticket = await tx.supportTicket.create({
            data: {
                guildId,
                openerId: actorId,
                participants: [actorId],
                staffRoles: config.staffRoles,
            },
        });
        const action = await tx.ticketAction.create({
            data: {
                guildId,
                ticketId: ticket.id,
                requestId,
                actorId,
                kind: 'open',
            },
        });
        return {
            ticket: await tx.supportTicket.update({
                where: { id: ticket.id },
                data: { heldActionId: action.id },
            }),
            action,
            fresh: true,
        };
    });
    if (!reserved.fresh || !reserved.action) return reserved.ticket;
    let started = false;
    try {
        // Every ticket starts with its own complete overwrite list; no category sync.
        started = true;
        const channel = await guild.channels.create({
            name: `ticket-${reserved.ticket.id.slice(0, 8)}`,
            type: ChannelType.GuildText,
            parent: config.categoryId,
            topic: `Backline ticket ${reserved.ticket.id}`,
            permissionOverwrites: ticketOverwrites(
                guildId,
                bot.id,
                [actor.id],
                config.staffRoles
            ),
            reason: 'Backline private support ticket',
        });
        return await finish(reserved.ticket, reserved.action.id, {
            channelId: channel.id,
            state: 'OPEN',
        });
    } catch {
        await failed(reserved.ticket, reserved.action.id, started);
        return db.supportTicket.findUniqueOrThrow({
            where: { id: reserved.ticket.id },
        });
    }
}
type Kind =
    | 'claim'
    | 'release'
    | 'add'
    | 'remove'
    | 'close'
    | 'reopen'
    | 'transcript';
export async function ticketAction(
    client: Client,
    guildId: string,
    actorId: string,
    requestId: string,
    ticketId: string,
    kind: Kind,
    targetId?: string
) {
    const { config, guild, actor, bot } = await context(
        client,
        guildId,
        actorId
    );
    const reserved = await db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
        );
        const ticket = await tx.supportTicket.findFirstOrThrow({
            where: { id: ticketId, guildId },
        });
        const prior = await tx.ticketAction.findUnique({
            where: { guildId_requestId: { guildId, requestId } },
        });
        if (prior) {
            if (
                prior.ticketId !== ticketId ||
                prior.actorId !== actorId ||
                prior.kind !== kind
            )
                throw new Error('Request mismatch');
            return { ticket, action: prior, fresh: false };
        }
        if (ticket.heldActionId)
            throw new Error('Previous ticket action held for investigation');
        if (!['OPEN', 'CLOSED'].includes(ticket.state))
            throw new Error('Ticket unavailable');
        const staff = ticketStaff(guild, actor, strings(ticket.staffRoles));
        if (
            !staff &&
            !(
                ['close', 'transcript'].includes(kind) &&
                strings(ticket.participants).includes(actorId)
            )
        )
            throw new Error('Ticket access denied');
        if (kind === 'reopen' && ticket.state !== 'CLOSED')
            throw new Error('Ticket is not closed');
        if (
            ['add', 'remove', 'claim', 'close'].includes(kind) &&
            ticket.state !== 'OPEN'
        )
            throw new Error('Ticket is not open');
        if (
            kind === 'claim' &&
            ticket.claimedBy &&
            ticket.claimedBy !== actorId
        )
            throw new Error('Ticket already claimed');
        if (
            kind === 'release' &&
            ticket.claimedBy !== actorId &&
            actorId !== guild.ownerId &&
            !actor.permissions.has(PermissionFlagsBits.Administrator)
        )
            throw new Error('Only the claimant may release');
        if (['add', 'remove'].includes(kind)) {
            id.parse(targetId);
            if (targetId === ticket.openerId || targetId === bot.id)
                throw new Error('Protected ticket participant');
            if (kind === 'add' && strings(ticket.participants).length >= 10)
                throw new Error('Participant capacity reached');
        }
        const action = await tx.ticketAction.create({
            data: { guildId, ticketId, actorId, requestId, kind },
        });
        return {
            ticket: await tx.supportTicket.update({
                where: { id: ticketId },
                data: { heldActionId: action.id },
            }),
            action,
            fresh: true,
        };
    });
    if (!reserved.fresh) return reserved.action;
    let started = false;
    try {
        const ticket = reserved.ticket;
        const channel = await guild.channels.fetch(ticket.channelId!);
        if (
            !channel ||
            channel.type !== ChannelType.GuildText ||
            channel.topic !== `Backline ticket ${ticket.id}`
        )
            throw new Error('Ticket channel identity unavailable');
        if (
            !channel.permissionsFor(actor)?.has(PermissionFlagsBits.ViewChannel)
        )
            throw new Error('Current ticket access denied');
        let update: Prisma.SupportTicketUpdateInput = {};
        if (kind === 'transcript') {
            if (
                !channel
                    .permissionsFor(bot)
                    ?.has([
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.ReadMessageHistory,
                    ])
            )
                throw new Error('Transcript access denied');
            const transcript = await collectTranscript(
                channel,
                config.retainContent && env.BOT_MESSAGE_CONTENT_INTENT
            );
            await db.ticketTranscript.upsert({
                where: { ticketId },
                create: {
                    ticketId,
                    guildId,
                    body: toInputJson(transcript.messages),
                    truncated: transcript.truncated,
                    containsContent:
                        config.retainContent && env.BOT_MESSAGE_CONTENT_INTENT,
                    expiresAt: new Date(
                        Date.now() + config.retentionDays * 86400000
                    ),
                },
                update: {
                    body: toInputJson(transcript.messages),
                    truncated: transcript.truncated,
                    containsContent:
                        config.retainContent && env.BOT_MESSAGE_CONTENT_INTENT,
                    expiresAt: new Date(
                        Date.now() + config.retentionDays * 86400000
                    ),
                },
            });
        } else if (kind === 'claim') update = { claimedBy: actorId };
        else if (kind === 'release') update = { claimedBy: null };
        else {
            const participants = new Set(strings(ticket.participants));
            if (kind === 'add') {
                await guild.members.fetch({ user: targetId!, force: true });
                participants.add(targetId!);
            }
            if (kind === 'remove') participants.delete(targetId!);
            const closed =
                kind === 'close' ||
                (ticket.state === 'CLOSED' && kind !== 'reopen');
            if (
                !channel
                    .permissionsFor(bot)
                    ?.has([
                        PermissionFlagsBits.ManageChannels,
                        PermissionFlagsBits.ManageRoles,
                    ])
            )
                throw new Error('Bot ticket mutation permission denied');
            started = true;
            await channel.permissionOverwrites.set(
                ticketOverwrites(
                    guildId,
                    bot.id,
                    [...participants],
                    strings(ticket.staffRoles),
                    closed
                )
            );
            update = {
                participants: [...participants],
                state: closed ? 'CLOSED' : 'OPEN',
                closedAt: closed ? new Date() : null,
                expiresAt: closed
                    ? new Date(Date.now() + config.retentionDays * 86400000)
                    : null,
            };
        }
        await finish(ticket, reserved.action.id, update);
    } catch {
        await failed(reserved.ticket, reserved.action.id, started);
    }
    return db.ticketAction.findUniqueOrThrow({
        where: { id: reserved.action.id },
    });
}
export async function collectTranscript(
    channel: Pick<TextChannel, 'messages'>,
    content: boolean
) {
    const messages: {
        id: string;
        authorId: string;
        at: string;
        content?: string;
    }[] = [];
    let before: string | undefined;
    for (let page = 0; page < 10; page++) {
        const batch = await channel.messages.fetch({
            limit: 100,
            ...(before ? { before } : {}),
        });
        for (const message of batch.values())
            messages.push({
                id: message.id,
                authorId: message.author.id,
                at: message.createdAt.toISOString(),
                ...(content ? { content: message.content.slice(0, 2000) } : {}),
            });
        if (batch.size < 100)
            return { messages: messages.reverse(), truncated: false };
        before = batch.last()?.id;
    }
    return { messages: messages.reverse(), truncated: true };
}
export async function expireTickets(client: Client) {
    await db.ticketTranscript.deleteMany({
        where: { expiresAt: { lte: new Date() } },
    });
    const due = await db.supportTicket.findMany({
        where: {
            state: 'CLOSED',
            heldActionId: null,
            expiresAt: { lte: new Date() },
        },
        take: 10,
    });
    for (const ticket of due) {
        if (!(await moduleRegistry.enabled(ticket.guildId, 'tickets')))
            continue;
        const action = await db.$transaction(async (tx) => {
            const record = await tx.ticketAction.upsert({
                where: {
                    guildId_requestId: {
                        guildId: ticket.guildId,
                        requestId: 'expire:' + ticket.id,
                    },
                },
                create: {
                    guildId: ticket.guildId,
                    ticketId: ticket.id,
                    requestId: 'expire:' + ticket.id,
                    actorId: 'system',
                    kind: 'expire',
                },
                update: {},
            });
            if (record.state !== 'PENDING') return null;
            const changed = await tx.supportTicket.updateMany({
                where: { id: ticket.id, state: 'CLOSED', heldActionId: null },
                data: { heldActionId: record.id },
            });
            return changed.count ? record : null;
        });
        if (!action || action.state !== 'PENDING') continue;
        let started = false;
        try {
            const guild = await client.guilds.fetch(ticket.guildId);
            const channel = await guild.channels.fetch(ticket.channelId!);
            if (
                !channel ||
                channel.type !== ChannelType.GuildText ||
                channel.topic !== `Backline ticket ${ticket.id}`
            )
                throw new Error('Identity mismatch');
            const bot = await guild.members.fetchMe({ force: true });
            if (
                !channel
                    .permissionsFor(bot)
                    ?.has(PermissionFlagsBits.ManageChannels)
            )
                throw new Error('Delete permission denied');
            started = true;
            await channel.delete('Backline closed-ticket retention expired');
            await finish(ticket, action.id, { state: 'EXPIRED' });
        } catch {
            await failed(ticket, action.id, started);
        }
    }
    // Held actions remain available for investigation. Completed ticket metadata expires after 90 days.
    const expired = await db.supportTicket.findMany({
        where: {
            state: { in: ['EXPIRED', 'FAILED'] },
            heldActionId: null,
            createdAt: { lt: new Date(Date.now() - 90 * 86400000) },
        },
        take: 100,
    });
    for (const row of expired)
        await db.$transaction(async (tx) => {
            await tx.ticketTranscript.deleteMany({
                where: { ticketId: row.id },
            });
            await tx.ticketAction.deleteMany({ where: { ticketId: row.id } });
            await tx.supportTicket.delete({ where: { id: row.id } });
        });
}
const ticket = new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Open or manage a private support ticket')
    .addSubcommand((sub) =>
        sub.setName('open').setDescription('Open your private ticket')
    );
for (const name of [
    'claim',
    'release',
    'close',
    'reopen',
    'transcript',
] as const)
    ticket.addSubcommand((sub) =>
        sub.setName(name).setDescription(`${name} this ticket`)
    );
for (const name of ['add', 'remove'] as const)
    ticket.addSubcommand((sub) =>
        sub
            .setName(name)
            .setDescription(`${name} a participant`)
            .addUserOption((option) =>
                option
                    .setName('member')
                    .setDescription('Ticket participant')
                    .setRequired(true)
            )
    );
export const ticketCommands = [
    ticket,
    new SlashCommandBuilder()
        .setName('ticket-panel')
        .setDescription('Publish a support ticket button')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map((command) => command.setContexts(0).setIntegrationTypes(0).toJSON());
export async function routeTickets(interaction: Interaction): Promise<boolean> {
    const button =
        interaction.isButton() &&
        interaction.customId === 'backline:ticket-open';
    if (
        !button &&
        (!interaction.isChatInputCommand() ||
            !['ticket', 'ticket-panel'].includes(interaction.commandName))
    )
        return false;
    const guildId = interaction.guildId!,
        actorId = interaction.user.id;
    if (
        interaction.isChatInputCommand() &&
        interaction.commandName === 'ticket-panel'
    ) {
        const { config, guild, actor } = await context(
            interaction.client,
            guildId,
            actorId
        );
        if (!actor.permissions.has(PermissionFlagsBits.ManageGuild))
            throw new Error('Manage Server required');
        const channel = await guild.channels.fetch(config.panelChannelId!);
        if (!channel || channel.type !== ChannelType.GuildText)
            throw new Error('Panel channel unavailable');
        const message = await channel.send({
            content: 'Open a private support ticket.',
            allowedMentions: { parse: [] },
            nonce: interaction.id,
            enforceNonce: true,
            components: [
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder()
                        .setCustomId('backline:ticket-open')
                        .setLabel('Open ticket')
                        .setStyle(ButtonStyle.Primary)
                ),
            ],
        });
        await interaction.editReply(`Ticket panel published: ${message.id}.`);
    } else {
        const kind = button
            ? 'open'
            : interaction.isChatInputCommand()
              ? interaction.options.getSubcommand()
              : '';
        if (kind === 'open') {
            const row = await openTicket(
                interaction.client,
                guildId,
                actorId,
                interaction.id
            );
            await interaction.editReply(
                `Ticket ${row.state}: ${row.channelId ? '<#' + row.channelId + '>' : row.id}`
            );
        } else if (interaction.isChatInputCommand()) {
            const row = await db.supportTicket.findFirstOrThrow({
                where: { guildId, channelId: interaction.channelId },
            });
            const result = await ticketAction(
                interaction.client,
                guildId,
                actorId,
                interaction.id,
                row.id,
                kind as Kind,
                interaction.options.getUser('member')?.id
            );
            if (kind === 'transcript' && result.state === 'DELIVERED') {
                const transcript = await db.ticketTranscript.findUniqueOrThrow({
                    where: { ticketId: row.id },
                });
                await interaction.editReply({
                    content: `Transcript: ${transcript.truncated ? 'latest 1000 messages; older history omitted' : 'available history'}. Content ${transcript.containsContent ? 'included' : 'unavailable or disabled'}.`,
                    files: [
                        new AttachmentBuilder(
                            Buffer.from(
                                JSON.stringify(transcript.body, null, 2)
                            ),
                            { name: `ticket-${row.id}.json` }
                        ),
                    ],
                    allowedMentions: { parse: [] },
                });
            } else
                await interaction.editReply(
                    `Ticket action ${result.state}${result.detail ? ': ' + result.detail : ''}.`
                );
        }
    }
    return true;
}
