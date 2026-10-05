import { randomInt } from 'crypto';

import { Giveaway, GiveawayDraw, Prisma } from '@prisma/client';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Client,
    GuildMember,
    Interaction,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';
import { z } from 'zod';

import { db } from '../db';
import { enqueueJob, JobHandler } from '../jobs/store';
import { moduleRegistry } from '../modules/registry';

import { giveawayConfig, id } from './config';

export const giveawayInput = z
    .object({
        channelId: id,
        prize: z.string().trim().min(1).max(200),
        winnerCount: z.number().int().min(1).max(10).default(1),
        requiredRoles: z.array(id).max(5).default([]),
        minJoinedDays: z.number().int().min(0).max(365).default(0),
        endsAt: z.coerce.date(),
    })
    .strict();

async function settings(guildId: string) {
    if (!(await moduleRegistry.enabled(guildId, 'giveaways')))
        throw new Error('Giveaways disabled');
    const row = await db.guildModuleConfig.findUniqueOrThrow({
        where: { guildId_moduleId: { guildId, moduleId: 'giveaways' } },
    });
    return giveawayConfig.parse(row.config);
}
async function lock(tx: Prisma.TransactionClient, guildId: string) {
    await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
    );
}
async function currentSettings(tx: Prisma.TransactionClient, guildId: string) {
    const row = await tx.guildModuleConfig.findUnique({
        where: { guildId_moduleId: { guildId, moduleId: 'giveaways' } },
    });
    if (!row?.enabled) throw new Error('Giveaways disabled');
    return giveawayConfig.parse(row.config);
}
export async function giveawayManager(
    client: Client,
    guildId: string,
    actorId: string
) {
    const account = await db.user.findUnique({ where: { discordId: actorId } });
    if (account?.role === 'BANNED') throw new Error('Account access revoked');
    const guild = await client.guilds.fetch({ guild: guildId, force: true });
    const member = await guild.members.fetch({ user: actorId, force: true });
    if (
        guild.ownerId !== member.id &&
        !member.permissions.has(PermissionFlagsBits.ManageGuild)
    )
        throw new Error('Current Manage Server permission required');
    return guild;
}
export function eligibleGiveawayMember(
    member: GuildMember,
    giveaway: Pick<Giveaway, 'requiredRoles' | 'minJoinedDays'>,
    now = Date.now()
) {
    return (
        !member.user.bot &&
        giveaway.requiredRoles.every((role) => member.roles.cache.has(role)) &&
        (giveaway.minJoinedDays === 0 ||
            (member.joinedTimestamp !== null &&
                now - member.joinedTimestamp >=
                    giveaway.minJoinedDays * 86400000))
    );
}
export function chooseWinners(candidates: string[], count: number) {
    const pool = [...new Set(candidates)].sort();
    const winners: string[] = [];
    while (pool.length && winners.length < count)
        winners.push(pool.splice(randomInt(pool.length), 1)[0]);
    return winners;
}
function message(giveaway: Giveaway, draw?: GiveawayDraw) {
    return {
        embeds: [
            {
                title: giveaway.prize,
                description: draw
                    ? `Draw ${draw.round}: ${draw.winners.length ? draw.winners.map((member) => `<@${member}>`).join(', ') : 'No eligible entrants.'}\n${draw.eligibleCount} eligible entrants. Previous draws remain in history.`
                    : `Ends <t:${Math.floor(giveaway.endsAt.getTime() / 1000)}:R>. ${giveaway.winnerCount} winner(s).\n${giveaway.requiredRoles.length ? 'Required roles: ' + giveaway.requiredRoles.map((role) => `<@&${role}>`).join(', ') + '\n' : ''}Minimum server membership: ${giveaway.minJoinedDays} days. Eligibility is checked again at draw time.`,
                footer: { text: `Giveaway ${giveaway.id}` },
            },
        ],
        components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`gwy:enter:${giveaway.id}`)
                    .setLabel('Enter')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(!!draw),
                new ButtonBuilder()
                    .setCustomId(`gwy:withdraw:${giveaway.id}`)
                    .setLabel('Withdraw')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!!draw)
            ),
        ],
        allowedMentions: { parse: [] as [] },
    };
}
export async function createGiveaway(
    client: Client,
    guildId: string,
    actorId: string,
    requestId: string,
    input: unknown
) {
    await settings(guildId);
    const guild = await giveawayManager(client, guildId, actorId);
    const data = giveawayInput.parse(input);
    if (
        data.endsAt.getTime() <= Date.now() ||
        data.endsAt.getTime() > Date.now() + 30 * 86400000
    )
        throw new Error('Deadline must be within the next 30 days');
    for (const roleId of data.requiredRoles)
        if (!(await guild.roles.fetch(roleId, { force: true })))
            throw new Error('Required role unavailable');
    const channel = await guild.channels.fetch(data.channelId);
    const bot = await guild.members.fetchMe({ force: true });
    if (
        !channel ||
        channel.type !== ChannelType.GuildText ||
        !channel
            .permissionsFor(bot)
            ?.has([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.ReadMessageHistory,
            ])
    )
        throw new Error('Giveaway channel permissions unavailable');
    const reserved = await db.$transaction(async (tx) => {
        await lock(tx, guildId);
        const currentConfig = await currentSettings(tx, guildId);
        const prior = await tx.giveaway.findUnique({
            where: { guildId_requestId: { guildId, requestId } },
        });
        if (prior) {
            if (prior.creatorId !== actorId)
                throw new Error('Request mismatch');
            return { giveaway: prior, fresh: false };
        }
        if (
            (await tx.giveaway.count({
                where: { guildId, state: { in: ['OPEN', 'CREATING'] } },
            })) >= currentConfig.maxActive
        )
            throw new Error('Active giveaway quota reached');
        return {
            giveaway: await tx.giveaway.create({
                data: {
                    ...data,
                    guildId,
                    creatorId: actorId,
                    requestId,
                    expiresAt: new Date(
                        data.endsAt.getTime() +
                            currentConfig.retentionDays * 86400000
                    ),
                },
            }),
            fresh: true,
        };
    });
    if (!reserved.fresh) return reserved.giveaway;
    // An uncertain initial send stays CREATING; never repeat a channel announcement.
    const sent = await channel.send(message(reserved.giveaway));
    const saved = await db.giveaway.update({
        where: { id: reserved.giveaway.id },
        data: { state: 'OPEN', messageId: sent.id },
    });
    await scheduleDraw(saved);
    return saved;
}
async function scheduleDraw(giveaway: Giveaway) {
    return enqueueJob({
        guildId: giveaway.guildId,
        actorId: giveaway.creatorId,
        moduleId: 'giveaways',
        kind: 'giveaway-draw',
        idempotencyKey: `giveaway-draw:${giveaway.id}`,
        payload: { giveawayId: giveaway.id },
        runAt: giveaway.endsAt,
        expiresAt: giveaway.expiresAt,
    });
}
export async function enterGiveaway(
    client: Client,
    guildId: string,
    giveawayId: string,
    memberId: string,
    withdraw = false
) {
    await settings(guildId);
    const giveaway = await db.giveaway.findFirstOrThrow({
        where: { id: giveawayId, guildId },
    });
    const guild = await client.guilds.fetch({ guild: guildId, force: true });
    const member = await guild.members.fetch({ user: memberId, force: true });
    if (!withdraw && !eligibleGiveawayMember(member, giveaway))
        throw new Error('Giveaway eligibility required');
    await db.$transaction(async (tx) => {
        await lock(tx, guildId);
        const currentConfig = await currentSettings(tx, guildId);
        const current = await tx.giveaway.findUniqueOrThrow({
            where: { id: giveaway.id },
        });
        if (current.state !== 'OPEN' || current.endsAt <= new Date())
            throw new Error('Giveaway entries closed');
        if (withdraw) {
            await tx.giveawayEntry.deleteMany({
                where: { giveawayId, memberId },
            });
            return;
        }
        const existing = await tx.giveawayEntry.findUnique({
            where: { giveawayId_memberId: { giveawayId, memberId } },
        });
        if (existing) return;
        if (
            (await tx.giveawayEntry.count({ where: { giveawayId } })) >=
            currentConfig.maxEntries
        )
            throw new Error('Entry quota reached');
        await tx.giveawayEntry.create({ data: { giveawayId, memberId } });
    });
}
export async function drawGiveaway(
    client: Client,
    guildId: string,
    giveawayId: string,
    actorId: string,
    requestId: string,
    reroll = false
) {
    await settings(guildId);
    const guild = await giveawayManager(client, guildId, actorId);
    const giveaway = await db.giveaway.findFirstOrThrow({
        where: { id: giveawayId, guildId },
        include: { draws: { orderBy: { round: 'asc' } }, entries: true },
    });
    const prior = giveaway.draws.find((draw) => draw.requestId === requestId);
    if (prior) {
        if (prior.actorId !== actorId) throw new Error('Request mismatch');
        return prior;
    }
    if (!reroll && giveaway.draws.length) return giveaway.draws[0];
    if (
        giveaway.expiresAt <= new Date() ||
        giveaway.endsAt > new Date() ||
        !['OPEN', 'DRAWN'].includes(giveaway.state)
    )
        throw new Error('Giveaway not ready to draw');
    if (
        reroll &&
        (!giveaway.draws.length ||
            giveaway.draws.length >= 11 ||
            giveaway.draws[giveaway.draws.length - 1]?.announcement !==
                'DELIVERED')
    )
        throw new Error(
            'Deliver the current draw before rerolling; ten rerolls maximum'
        );
    const excluded = new Set(giveaway.draws.flatMap((draw) => draw.winners));
    const eligible: string[] = [];
    for (const entry of giveaway.entries) {
        if (excluded.has(entry.memberId)) continue;
        try {
            const member = await guild.members.fetch({
                user: entry.memberId,
                force: true,
            });
            if (eligibleGiveawayMember(member, giveaway))
                eligible.push(entry.memberId);
        } catch (error) {
            // A departed member is ineligible; transport failures must not bias the draw.
            if (
                !(
                    error instanceof Error &&
                    'code' in error &&
                    error.code === 10007
                )
            )
                throw error;
        }
    }
    return db.$transaction(async (tx) => {
        await lock(tx, guildId);
        await currentSettings(tx, guildId);
        const current = await tx.giveaway.findUniqueOrThrow({
            where: { id: giveawayId },
            include: { draws: { orderBy: { round: 'asc' } } },
        });
        const repeated = current.draws.find(
            (draw) => draw.requestId === requestId
        );
        if (repeated) return repeated;
        if (!reroll && current.draws.length) return current.draws[0];
        if (
            !['OPEN', 'DRAWN'].includes(current.state) ||
            current.draws.length !== giveaway.draws.length
        )
            throw new Error('Draw changed; retry with current history');
        await tx.giveaway.update({
            where: { id: giveawayId },
            data: { state: 'DRAWN' },
        });
        return tx.giveawayDraw.create({
            data: {
                giveawayId,
                actorId,
                requestId,
                round: current.draws.length + 1,
                eligibleCount: eligible.length,
                winners: chooseWinners(eligible, giveaway.winnerCount),
            },
        });
    });
}
export async function announceDraw(
    client: Client,
    guildId: string,
    draw: GiveawayDraw
) {
    await settings(guildId);
    const guild = await client.guilds.fetch({ guild: guildId, force: true });
    const bot = await guild.members.fetchMe({ force: true });
    await db.$transaction(
        async (tx) => {
            // Serialize the edit with reroll commits so an old result cannot replace a newer round.
            await lock(tx, guildId);
            await currentSettings(tx, guildId);
            const giveaway = await tx.giveaway.findFirstOrThrow({
                where: { id: draw.giveawayId, guildId },
                include: { draws: { orderBy: { round: 'desc' }, take: 1 } },
            });
            if (giveaway.state !== 'DRAWN' || giveaway.draws[0]?.id !== draw.id)
                return;
            if (giveaway.expiresAt <= new Date())
                throw new Error('Giveaway history expired');
            const current = giveaway.draws[0];
            if (current.announcement === 'DELIVERED') return;
            const channel = await guild.channels.fetch(giveaway.channelId);
            if (
                !channel ||
                channel.type !== ChannelType.GuildText ||
                !giveaway.messageId ||
                !channel
                    .permissionsFor(bot)
                    ?.has([
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.EmbedLinks,
                    ])
            )
                throw new Error('Giveaway result channel unavailable');
            const original = await channel.messages.fetch(giveaway.messageId);
            if (original.author.id !== bot.id)
                throw new Error('Giveaway message author mismatch');
            // Editing one recorded message with one persisted result can safely repeat after a lost lease.
            await original.edit(message(giveaway, current));
            await tx.giveawayDraw.update({
                where: { id: current.id },
                data: { announcement: 'DELIVERED' },
            });
        },
        { timeout: 15000 }
    );
}
export function giveawayHandlers(client: Client): [string, JobHandler][] {
    return [
        [
            'giveaway-create',
            {
                authorize: async (job) => {
                    try {
                        await giveawayManager(client, job.guildId, job.actorId);
                        return true;
                    } catch {
                        return false;
                    }
                },
                execute: async (job) => {
                    const result = await createGiveaway(
                        client,
                        job.guildId,
                        job.actorId,
                        job.id,
                        job.payload
                    );
                    return result.state === 'OPEN'
                        ? {
                              state: 'DELIVERED',
                              result: {
                                  giveawayId: result.id,
                                  messageId: result.messageId,
                              },
                          }
                        : {
                              state: 'RECONCILE',
                              reason: 'Initial announcement outcome requires investigation',
                          };
                },
                reconcile: async (job) => {
                    const result = await db.giveaway.findUnique({
                        where: {
                            guildId_requestId: {
                                guildId: job.guildId,
                                requestId: job.id,
                            },
                        },
                    });
                    if (!result)
                        return {
                            state: 'RETRY',
                            reason: 'No reservation exists, so no announcement was attempted',
                        };
                    return result?.messageId
                        ? {
                              state: 'DELIVERED',
                              result: {
                                  giveawayId: result.id,
                                  messageId: result.messageId,
                              },
                          }
                        : {
                              state: 'RECONCILE',
                              reason: 'Initial announcement outcome requires investigation',
                          };
                },
            },
        ],
        ...(['giveaway-draw', 'giveaway-reroll'] as const).map<
            [string, JobHandler]
        >((kind) => [
            kind,
            {
                authorize: async (job) => {
                    try {
                        await giveawayManager(client, job.guildId, job.actorId);
                        return true;
                    } catch {
                        return false;
                    }
                },
                execute: async (job) => {
                    const payload = z
                        .object({ giveawayId: z.string().uuid() })
                        .parse(job.payload);
                    const draw = await drawGiveaway(
                        client,
                        job.guildId,
                        payload.giveawayId,
                        job.actorId,
                        job.id,
                        kind === 'giveaway-reroll'
                    );
                    await announceDraw(client, job.guildId, draw);
                    return {
                        state: 'DELIVERED',
                        result: {
                            drawId: draw.id,
                            round: draw.round,
                            winners: draw.winners,
                        },
                    };
                },
                reconcile: () =>
                    Promise.resolve({
                        state: 'RETRY',
                        reason: 'Persisted draws and edits to the recorded result message can safely resume',
                    }),
            },
        ]),
    ];
}
export async function recoverGiveaways() {
    const open = await db.$queryRaw<Giveaway[]>(Prisma.sql`
        SELECT * FROM "Giveaway" AS g WHERE g."state" = 'OPEN' AND g."expiresAt" > NOW()
        AND NOT EXISTS (SELECT 1 FROM "DurableJob" AS j
            WHERE j."guildId" = g."guildId" AND j."idempotencyKey" = 'giveaway-draw:' || g."id")
        ORDER BY g."endsAt" LIMIT 100
    `);
    for (const giveaway of open) await scheduleDraw(giveaway);
    const expired = await db.giveaway.findMany({
        where: { expiresAt: { lte: new Date() }, state: { not: 'CREATING' } },
        take: 100,
    });
    for (const giveaway of expired)
        await db.durableJob.deleteMany({
            where: {
                guildId: giveaway.guildId,
                kind: {
                    in: ['giveaway-create', 'giveaway-draw', 'giveaway-reroll'],
                },
                state: { in: ['DELIVERED', 'FAILED', 'CANCELLED'] },
                OR: [
                    { id: giveaway.requestId },
                    { idempotencyKey: `giveaway-draw:${giveaway.id}` },
                    { payload: { path: ['giveawayId'], equals: giveaway.id } },
                ],
            },
        });
    await db.giveaway.deleteMany({
        where: { id: { in: expired.map((giveaway) => giveaway.id) } },
    });
}
export const giveawayCommand = new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Enter, create or review server giveaways')
    .addSubcommand((command) =>
        command
            .setName('create')
            .setDescription('Create a giveaway; Manage Server required')
            .addStringOption((option) =>
                option
                    .setName('prize')
                    .setDescription('Prize description')
                    .setRequired(true)
                    .setMaxLength(200)
            )
            .addIntegerOption((option) =>
                option
                    .setName('minutes')
                    .setDescription('Minutes until draw')
                    .setRequired(true)
                    .setMinValue(1)
                    .setMaxValue(43200)
            )
            .addChannelOption((option) =>
                option
                    .setName('channel')
                    .setDescription('Giveaway announcement channel')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true)
            )
            .addIntegerOption((option) =>
                option
                    .setName('winners')
                    .setDescription('Number of winners')
                    .setMinValue(1)
                    .setMaxValue(10)
            )
            .addRoleOption((option) =>
                option
                    .setName('required-role')
                    .setDescription('Role required at entry and draw')
            )
            .addIntegerOption((option) =>
                option
                    .setName('joined-days')
                    .setDescription('Minimum days in this server')
                    .setMinValue(0)
                    .setMaxValue(365)
            )
    )
    .addSubcommand((command) =>
        command
            .setName('draw')
            .setDescription(
                'Resume a giveaway after its deadline; Manage Server required'
            )
            .addStringOption((option) =>
                option
                    .setName('id')
                    .setDescription('Giveaway ID')
                    .setRequired(true)
            )
    )
    .addSubcommand((command) =>
        command
            .setName('reroll')
            .setDescription(
                'Draw again, excluding prior winners; Manage Server required'
            )
            .addStringOption((option) =>
                option
                    .setName('id')
                    .setDescription('Giveaway ID')
                    .setRequired(true)
            )
    )
    .addSubcommand((command) =>
        command
            .setName('history')
            .setDescription('View recorded giveaway draws')
            .addStringOption((option) =>
                option
                    .setName('id')
                    .setDescription('Giveaway ID')
                    .setRequired(true)
            )
    )
    .setContexts(0)
    .setIntegrationTypes(0)
    .toJSON();
export async function routeGiveaways(
    interaction: Interaction
): Promise<boolean> {
    if (
        !interaction.inGuild() ||
        !interaction.guild ||
        !interaction.isRepliable()
    )
        return false;
    if (interaction.isButton() && interaction.customId.startsWith('gwy:')) {
        const [, action, giveawayId] = interaction.customId.split(':');
        if (!['enter', 'withdraw'].includes(action))
            throw new Error('Unknown giveaway control');
        await enterGiveaway(
            interaction.client,
            interaction.guildId,
            giveawayId,
            interaction.user.id,
            action === 'withdraw'
        );
        await interaction.editReply(
            action === 'withdraw'
                ? 'Entry withdrawn.'
                : 'Entry saved. Eligibility is checked again at draw time.'
        );
        return true;
    }
    if (
        !interaction.isChatInputCommand() ||
        interaction.commandName !== 'giveaway'
    )
        return false;
    const command = interaction.options.getSubcommand();
    if (command === 'create') {
        const role = interaction.options.getRole('required-role');
        const giveaway = await createGiveaway(
            interaction.client,
            interaction.guildId,
            interaction.user.id,
            interaction.id,
            {
                prize: interaction.options.getString('prize', true),
                channelId: interaction.options.getChannel('channel', true).id,
                winnerCount: interaction.options.getInteger('winners') ?? 1,
                requiredRoles: role ? [role.id] : [],
                minJoinedDays:
                    interaction.options.getInteger('joined-days') ?? 0,
                endsAt: new Date(
                    Date.now() +
                        interaction.options.getInteger('minutes', true) * 60000
                ),
            }
        );
        await interaction.editReply(
            giveaway.state === 'OPEN'
                ? `Giveaway created: ${giveaway.id}`
                : 'Announcement outcome is held for investigation.'
        );
    } else {
        const giveawayId = interaction.options.getString('id', true);
        if (command === 'reroll' || command === 'draw') {
            const draw = await drawGiveaway(
                interaction.client,
                interaction.guildId,
                giveawayId,
                interaction.user.id,
                interaction.id,
                command === 'reroll'
            );
            await announceDraw(interaction.client, interaction.guildId, draw);
            await interaction.editReply(
                `Draw ${draw.round} recorded and announced.`
            );
        } else {
            await settings(interaction.guildId);
            const giveaway = await db.giveaway.findFirstOrThrow({
                where: { id: giveawayId, guildId: interaction.guildId },
                include: { draws: { orderBy: { round: 'asc' } } },
            });
            await interaction.editReply({
                embeds: [
                    {
                        title: giveaway.prize,
                        description: `${giveaway.state}${giveaway.draws.length ? '' : ' — no draw recorded yet'}`,
                        fields: giveaway.draws.map((draw) => ({
                            name: `Draw ${draw.round}`,
                            value: `${draw.winners.join(', ') || 'No eligible entrants'} (${draw.announcement})`,
                        })),
                    },
                ],
            });
        }
    }
    return true;
}
