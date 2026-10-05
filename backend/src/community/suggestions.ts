import { DurableJob, Prisma } from '@prisma/client';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Client,
    Interaction,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';
import { z } from 'zod';

import { db } from '../db';
import { JobHandler } from '../jobs/store';
import { moduleRegistry } from '../modules/registry';

import { suggestionsConfig } from './memberUtilityConfig';

async function lock(tx: Prisma.TransactionClient, guildId: string) {
    await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
    );
}
async function current(tx: Prisma.TransactionClient, guildId: string) {
    const [installation, settings] = await Promise.all([
        tx.guildInstallation.findUnique({ where: { guildId } }),
        tx.guildModuleConfig.findUnique({
            where: { guildId_moduleId: { guildId, moduleId: 'suggestions' } },
        }),
    ]);
    if (!installation?.active || !settings?.enabled || settings.version !== 1)
        throw new Error('Suggestions disabled');
    return suggestionsConfig.parse(settings.config);
}
async function destination(
    client: Client,
    guildId: string,
    actorId: string,
    manager = false
) {
    if (!(await moduleRegistry.enabled(guildId, 'suggestions')))
        throw new Error('Suggestions disabled');
    const config = suggestionsConfig.parse(
        (
            await db.guildModuleConfig.findUniqueOrThrow({
                where: {
                    guildId_moduleId: { guildId, moduleId: 'suggestions' },
                },
            })
        ).config
    );
    if (!config.channelId)
        throw new Error('Configure a suggestion channel first');
    const guild = await client.guilds.fetch({ guild: guildId, force: true });
    const [actor, bot, channel, account] = await Promise.all([
        guild.members.fetch({ user: actorId, force: true }),
        guild.members.fetchMe({ force: true }),
        guild.channels.fetch(config.channelId, { force: true }),
        db.user.findUnique({
            where: { discordId: actorId },
            select: { role: true },
        }),
    ]);
    if (actor.user.bot || account?.role === 'BANNED')
        throw new Error('Account unavailable');
    if (
        !channel ||
        channel.type !== ChannelType.GuildText ||
        !channel.permissionsFor(actor)?.has(PermissionFlagsBits.ViewChannel)
    )
        throw new Error('Suggestion channel unavailable');
    if (manager && !actor.permissions.has(PermissionFlagsBits.ManageGuild))
        throw new Error('Manage Server required');
    if (
        !channel
            .permissionsFor(bot)
            ?.has([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
            ])
    )
        throw new Error('Bot suggestion permissions unavailable');
    return channel;
}
export async function createSuggestion(
    client: Client,
    guildId: string,
    actorId: string,
    requestId: string,
    input: unknown
) {
    const content = z.string().trim().min(1).max(1200).parse(input);
    if (!requestId || requestId.length > 100)
        throw new Error('Invalid request');
    const channel = await destination(client, guildId, actorId);
    return db.$transaction(async (tx) => {
        await lock(tx, guildId);
        const config = await current(tx, guildId);
        if (config.channelId !== channel.id)
            throw new Error('Suggestion destination changed; retry');
        const previous = await tx.communitySuggestion.findUnique({
            where: { guildId_requestId: { guildId, requestId } },
        });
        if (previous) {
            if (previous.actorId !== actorId)
                throw new Error('Request belongs to another member');
            return previous;
        }
        if (
            (await tx.communitySuggestion.count({ where: { guildId } })) >=
                1000 ||
            (await tx.communitySuggestion.count({
                where: {
                    guildId,
                    actorId,
                    createdAt: { gt: new Date(Date.now() - 86400000) },
                },
            })) >= 10
        )
            throw new Error('Suggestion capacity reached');
        if (
            (await tx.durableJob.count({
                where: {
                    guildId,
                    state: { in: ['PENDING', 'LEASED', 'RECONCILE'] },
                },
            })) >= 1000
        )
            throw new Error('Server action capacity reached');
        const suggestion = await tx.communitySuggestion.create({
            data: {
                guildId,
                actorId,
                requestId,
                channelId: channel.id,
                content,
            },
        });
        await tx.durableJob.create({
            data: {
                guildId,
                actorId,
                moduleId: 'suggestions',
                kind: 'suggestion-publish',
                idempotencyKey: 'suggestion:' + suggestion.id,
                payload: { suggestionId: suggestion.id },
                runAt: new Date(),
                expiresAt: new Date(Date.now() + 86400000),
            },
        });
        return suggestion;
    });
}
export async function voteSuggestion(
    client: Client,
    guildId: string,
    actorId: string,
    suggestionId: string,
    value: number
) {
    z.enum(['1', '-1']).parse(String(value));
    const channel = await destination(client, guildId, actorId);
    return db.$transaction(async (tx) => {
        await lock(tx, guildId);
        await current(tx, guildId);
        const suggestion = await tx.communitySuggestion.findFirst({
            where: {
                id: suggestionId,
                guildId,
                channelId: channel.id,
                state: 'OPEN',
                deliveryState: 'DELIVERED',
            },
        });
        if (!suggestion) throw new Error('Open suggestion unavailable');
        const prior = await tx.suggestionVote.findUnique({
            where: {
                suggestionId_memberId: { suggestionId, memberId: actorId },
            },
        });
        if (
            !prior &&
            (await tx.suggestionVote.count({ where: { suggestionId } })) >=
                10000
        )
            throw new Error('Vote capacity reached');
        await tx.suggestionVote.upsert({
            where: {
                suggestionId_memberId: { suggestionId, memberId: actorId },
            },
            create: { suggestionId, memberId: actorId, value },
            update: { value },
        });
    });
}
export async function reviewSuggestion(
    client: Client,
    guildId: string,
    actorId: string,
    suggestionId: string,
    state: unknown,
    reason: unknown
) {
    const decision = z.enum(['ACCEPTED', 'DECLINED']).parse(state),
        text = z.string().trim().min(1).max(400).parse(reason);
    const channel = await destination(client, guildId, actorId, true);
    return db.$transaction(async (tx) => {
        await lock(tx, guildId);
        await current(tx, guildId);
        const changed = await tx.communitySuggestion.updateMany({
            where: {
                id: suggestionId,
                guildId,
                channelId: channel.id,
                state: 'OPEN',
            },
            data: { state: decision, decision: text, reviewerId: actorId },
        });
        if (!changed.count) throw new Error('Open suggestion unavailable');
    });
}
async function eventFor(job: DurableJob) {
    const { suggestionId } = z
        .object({ suggestionId: z.string().uuid() })
        .strict()
        .parse(job.payload);
    return db.communitySuggestion.findFirstOrThrow({
        where: { id: suggestionId, guildId: job.guildId, actorId: job.actorId },
    });
}
export function suggestionHandler(client: Client): JobHandler {
    return {
        authorize: async (job) => {
            const event = await eventFor(job);
            const channel = await destination(client, job.guildId, job.actorId);
            return event.channelId === channel.id;
        },
        execute: async (job) => {
            const event = await eventFor(job),
                channel = await destination(client, job.guildId, job.actorId);
            return db.$transaction(
                async (tx) => {
                    await lock(tx, job.guildId);
                    const config = await current(tx, job.guildId);
                    if (
                        config.channelId !== event.channelId ||
                        channel.id !== event.channelId
                    )
                        return {
                            state: 'CANCELLED',
                            reason: 'Suggestion destination changed',
                        };
                    const fresh =
                        await tx.communitySuggestion.findUniqueOrThrow({
                            where: { id: event.id },
                        });
                    if (fresh.messageId && fresh.deliveryState === 'DELIVERED')
                        return {
                            state: 'DELIVERED',
                            result: {
                                messageId: fresh.messageId,
                                suggestionId: fresh.id,
                            },
                        };
                    if (fresh.deliveryState !== 'PENDING')
                        return {
                            state: 'RECONCILE',
                            reason: 'Prior publish requires readback',
                        };
                    await tx.communitySuggestion.update({
                        where: { id: fresh.id },
                        data: { deliveryState: 'STARTED' },
                    });
                    try {
                        const message = await channel.send({
                            content: `Suggestion ${fresh.id}\n${fresh.content}\nVote below. Use /suggest view for current totals and staff decisions.`,
                            allowedMentions: { parse: [] },
                            components: [
                                new ActionRowBuilder<ButtonBuilder>().addComponents(
                                    new ButtonBuilder()
                                        .setCustomId(
                                            'suggestion:' + fresh.id + ':1'
                                        )
                                        .setLabel('Support')
                                        .setStyle(ButtonStyle.Success),
                                    new ButtonBuilder()
                                        .setCustomId(
                                            'suggestion:' + fresh.id + ':-1'
                                        )
                                        .setLabel('Oppose')
                                        .setStyle(ButtonStyle.Secondary)
                                ),
                            ],
                        });
                        await tx.communitySuggestion.update({
                            where: { id: fresh.id },
                            data: {
                                deliveryState: 'DELIVERED',
                                messageId: message.id,
                            },
                        });
                        return {
                            state: 'DELIVERED',
                            result: {
                                messageId: message.id,
                                suggestionId: fresh.id,
                            },
                        };
                    } catch {
                        await tx.communitySuggestion.update({
                            where: { id: fresh.id },
                            data: { deliveryState: 'UNCERTAIN' },
                        });
                        return {
                            state: 'RECONCILE',
                            reason: 'Suggestion publish uncertain; inspect destination before recreating',
                        };
                    }
                },
                { timeout: 60000 }
            );
        },
        reconcile: async (job) => {
            const event = await eventFor(job);
            if (!event.messageId)
                return {
                    state: 'RECONCILE',
                    reason: 'No suggestion receipt; inspect destination',
                };
            const channel = await destination(client, job.guildId, job.actorId);
            if (channel.id !== event.channelId)
                return { state: 'RECONCILE', reason: 'Destination changed' };
            const message = await channel.messages.fetch({
                message: event.messageId,
                force: true,
            });
            return message.author.id === client.user?.id
                ? {
                      state: 'DELIVERED',
                      result: { messageId: message.id, suggestionId: event.id },
                  }
                : {
                      state: 'RECONCILE',
                      reason: 'Suggestion authorship mismatch',
                  };
        },
    };
}
export async function expireSuggestions() {
    const old = await db.communitySuggestion.findMany({
        where: { createdAt: { lt: new Date(Date.now() - 30 * 86400000) } },
        take: 100,
    });
    for (const event of old)
        await db.$transaction(async (tx) => {
            await lock(tx, event.guildId);
            const where = {
                guildId: event.guildId,
                idempotencyKey: 'suggestion:' + event.id,
            };
            if (
                await tx.durableJob.count({
                    where: { ...where, state: { in: ['LEASED', 'RECONCILE'] } },
                })
            )
                return;
            await tx.jobAttempt.deleteMany({ where: { job: where } });
            await tx.durableJob.deleteMany({ where });
            await tx.communitySuggestion.deleteMany({
                where: { id: event.id, guildId: event.guildId },
            });
        });
}
export const suggestCommand = new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Submit, view or review server ideas')
    .setContexts(0)
    .setIntegrationTypes(0)
    .addSubcommand((s) =>
        s
            .setName('create')
            .setDescription('Submit an idea to the configured channel')
            .addStringOption((o) =>
                o
                    .setName('idea')
                    .setDescription('Suggestion text')
                    .setMaxLength(1200)
                    .setRequired(true)
            )
    )
    .addSubcommand((s) =>
        s
            .setName('view')
            .setDescription('Read vote totals and staff decision')
            .addStringOption((o) =>
                o
                    .setName('id')
                    .setDescription('Suggestion ID')
                    .setRequired(true)
            )
    )
    .addSubcommand((s) =>
        s
            .setName('review')
            .setDescription('Managers can accept or decline an idea')
            .addStringOption((o) =>
                o
                    .setName('id')
                    .setDescription('Suggestion ID')
                    .setRequired(true)
            )
            .addStringOption((o) =>
                o
                    .setName('decision')
                    .setDescription('Staff decision')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Accept', value: 'ACCEPTED' },
                        { name: 'Decline', value: 'DECLINED' }
                    )
            )
            .addStringOption((o) =>
                o
                    .setName('reason')
                    .setDescription('Reason for the decision')
                    .setMaxLength(400)
                    .setRequired(true)
            )
    )
    .toJSON();
export async function routeSuggestions(
    interaction: Interaction
): Promise<boolean> {
    const button =
        interaction.isButton() &&
        interaction.customId.startsWith('suggestion:');
    if (
        !button &&
        (!interaction.isChatInputCommand() ||
            interaction.commandName !== 'suggest')
    )
        return false;
    if (!interaction.guild) throw new Error('Server required');
    const guildId = interaction.guild.id,
        actorId = interaction.user.id;
    if (interaction.isButton()) {
        const [, id, value] = interaction.customId.split(':');
        await voteSuggestion(
            interaction.client,
            guildId,
            actorId,
            z.string().uuid().parse(id),
            Number(value)
        );
        await interaction.editReply(
            'Your vote is saved. You can change it while the suggestion is open.'
        );
        return true;
    }
    if (!interaction.isChatInputCommand()) return false;
    const action = interaction.options.getSubcommand();
    if (action === 'create') {
        const record = await createSuggestion(
            interaction.client,
            guildId,
            actorId,
            interaction.id,
            interaction.options.getString('idea', true)
        );
        await interaction.editReply(
            `Suggestion queued: ${record.id}. Check the suggestion channel for delivery.`
        );
    } else if (action === 'review') {
        await reviewSuggestion(
            interaction.client,
            guildId,
            actorId,
            interaction.options.getString('id', true),
            interaction.options.getString('decision', true),
            interaction.options.getString('reason', true)
        );
        await interaction.editReply(
            'Decision saved. The suggestion is now closed to votes.'
        );
    } else {
        const channel = await destination(interaction.client, guildId, actorId);
        const record = await db.communitySuggestion.findFirstOrThrow({
            where: {
                id: interaction.options.getString('id', true),
                guildId,
                channelId: channel.id,
            },
        });
        const votes = await db.suggestionVote.groupBy({
            by: ['value'],
            where: { suggestionId: record.id },
            _count: { _all: true },
        });
        await interaction.editReply({
            content: `${record.content}\nState: ${record.state}; delivery: ${record.deliveryState}\nSupport: ${votes.find((v) => v.value === 1)?._count._all ?? 0}; oppose: ${votes.find((v) => v.value === -1)?._count._all ?? 0}\n${record.decision ?? 'Awaiting staff review'}`,
            allowedMentions: { parse: [] },
        });
    }
    return true;
}
