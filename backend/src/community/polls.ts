import { DurableJob, Prisma } from '@prisma/client';
import {
    ChannelType,
    Client,
    Interaction,
    PermissionFlagsBits,
    Routes,
    SlashCommandBuilder,
} from 'discord.js';
import { z } from 'zod';

import { db } from '../db';
import { JobHandler } from '../jobs/store';
import { moduleRegistry } from '../modules/registry';

const snowflake = z.string().regex(/^\d{17,20}$/);
export const pollInput = z
    .object({
        channelId: snowflake,
        question: z.string().trim().min(1).max(300),
        answers: z
            .array(z.string().trim().min(1).max(55))
            .min(2)
            .max(10)
            .refine(
                (values) =>
                    new Set(values.map((value) => value.toLowerCase())).size ===
                    values.length,
                'Answers must be distinct'
            ),
        duration: z.number().int().min(1).max(768).default(24),
        multiselect: z.boolean().default(false),
    })
    .strict();
const payload = z.discriminatedUnion('action', [
    pollInput.extend({ action: z.literal('create') }),
    z
        .object({
            action: z.literal('close'),
            channelId: snowflake,
            messageId: snowflake,
        })
        .strict(),
]);

async function destination(
    client: Client,
    guildId: string,
    actorId: string,
    channelId: string,
    manager: boolean
) {
    if (!(await moduleRegistry.enabled(guildId, 'polls')))
        throw new Error('Polls disabled');
    const guild = await client.guilds.fetch({ guild: guildId, force: true });
    const [actor, bot, channel, account] = await Promise.all([
        guild.members.fetch({ user: actorId, force: true }),
        guild.members.fetchMe({ force: true }),
        guild.channels.fetch(channelId, { force: true }),
        db.user.findUnique({
            where: { discordId: actorId },
            select: { role: true },
        }),
    ]);
    if (actor.user.bot || account?.role === 'BANNED')
        throw new Error('Account unavailable');
    if (!channel || channel.type !== ChannelType.GuildText)
        throw new Error('A server text channel is required');
    if (
        !channel
            .permissionsFor(actor)
            ?.has([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory,
            ])
    )
        throw new Error('Channel access denied');
    if (manager && !actor.permissions.has(PermissionFlagsBits.ManageGuild))
        throw new Error('Manage Server required');
    if (
        manager &&
        !channel
            .permissionsFor(bot)
            ?.has([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.SendPolls,
                PermissionFlagsBits.ReadMessageHistory,
            ])
    )
        throw new Error('Bot poll permissions unavailable');
    return channel;
}

export async function queuePoll(
    client: Client,
    guildId: string,
    actorId: string,
    requestId: string,
    input: unknown
) {
    const parsed = payload.parse(input);
    if (!requestId || requestId.length > 100)
        throw new Error('Invalid request');
    const channel = await destination(
        client,
        guildId,
        actorId,
        parsed.channelId,
        true
    );
    if (parsed.action === 'close') {
        const message = await channel.messages.fetch({
            message: parsed.messageId,
            force: true,
        });
        if (message.author.id !== client.user?.id || !message.poll)
            throw new Error('Backline poll unavailable');
    }
    return db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
        );
        const installation = await tx.guildInstallation.findUnique({
            where: { guildId },
        });
        const config = await tx.guildModuleConfig.findUnique({
            where: { guildId_moduleId: { guildId, moduleId: 'polls' } },
        });
        if (!installation?.active || !config?.enabled || config.version !== 1)
            throw new Error('Polls disabled');
        const idempotencyKey = 'poll:' + requestId;
        const previous = await tx.durableJob.findUnique({
            where: { guildId_idempotencyKey: { guildId, idempotencyKey } },
        });
        if (previous) {
            if (previous.actorId !== actorId)
                throw new Error('Request belongs to another member');
            return previous;
        }
        if (
            (await tx.durableJob.count({
                where: { guildId, kind: 'native-poll' },
            })) >= 1000 ||
            (await tx.durableJob.count({
                where: {
                    guildId,
                    state: { in: ['PENDING', 'LEASED', 'RECONCILE'] },
                },
            })) >= 1000
        )
            throw new Error('Poll action capacity reached');
        return tx.durableJob.create({
            data: {
                guildId,
                actorId,
                moduleId: 'polls',
                kind: 'native-poll',
                idempotencyKey,
                payload: parsed,
                runAt: new Date(),
                expiresAt: new Date(Date.now() + 86400000),
                maxAttempts: 1,
            },
        });
    });
}

async function currentMessage(
    client: Client,
    job: DurableJob,
    messageId: string
) {
    const parsed = payload.parse(job.payload);
    const channel = await destination(
        client,
        job.guildId,
        job.actorId,
        parsed.channelId,
        true
    );
    const message = await channel.messages.fetch({
        message: messageId,
        force: true,
    });
    if (message.author.id !== client.user?.id || !message.poll)
        throw new Error('Backline poll unavailable');
    return message;
}

export function pollHandler(client: Client): JobHandler {
    return {
        authorize: async (job) => {
            const parsed = payload.parse(job.payload);
            await destination(
                client,
                job.guildId,
                job.actorId,
                parsed.channelId,
                true
            );
            return true;
        },
        execute: async (job) => {
            const parsed = payload.parse(job.payload);
            const channel = await destination(
                client,
                job.guildId,
                job.actorId,
                parsed.channelId,
                true
            );
            if (parsed.action === 'close') {
                const message = await currentMessage(
                    client,
                    job,
                    parsed.messageId
                );
                if (
                    !message.poll!.expiresAt ||
                    message.poll!.expiresAt > new Date()
                )
                    await message.poll!.end();
                return {
                    state: 'DELIVERED',
                    result: {
                        messageId: message.id,
                        channelId: parsed.channelId,
                        action: 'close',
                    },
                };
            }
            const message = await channel.send({
                allowedMentions: { parse: [], repliedUser: false },
                poll: {
                    question: { text: parsed.question },
                    answers: parsed.answers.map((text) => ({ text })),
                    duration: parsed.duration,
                    allowMultiselect: parsed.multiselect,
                },
            });
            return {
                state: 'DELIVERED',
                result: {
                    messageId: message.id,
                    channelId: parsed.channelId,
                    action: 'create',
                },
            };
        },
        reconcile: async (job) => {
            const parsed = payload.parse(job.payload);
            const receipt = z
                .object({ messageId: snowflake })
                .passthrough()
                .safeParse(job.result);
            if (parsed.action === 'create' && !receipt.success)
                return {
                    state: 'RECONCILE',
                    reason: 'Poll receipt missing; check destination before recreating',
                };
            const message = await currentMessage(
                client,
                job,
                parsed.action === 'close'
                    ? parsed.messageId
                    : receipt.success
                      ? receipt.data.messageId
                      : ''
            );
            if (
                parsed.action === 'close' &&
                (!message.poll!.expiresAt ||
                    message.poll!.expiresAt > new Date())
            )
                return {
                    state: 'RECONCILE',
                    reason: 'Poll is still open; check before closing again',
                };
            return {
                state: 'DELIVERED',
                result: {
                    messageId: message.id,
                    channelId: parsed.channelId,
                    action: parsed.action,
                },
            };
        },
    };
}

export async function expirePollJobs() {
    const where = {
        kind: 'native-poll',
        state: { in: ['DELIVERED', 'CANCELLED', 'FAILED'] },
        createdAt: { lt: new Date(Date.now() - 32 * 86400000) },
    };
    await db.$transaction(async (tx) => {
        await tx.jobAttempt.deleteMany({ where: { job: where } });
        await tx.durableJob.deleteMany({ where });
    });
}

export type NativePollResults = {
    question: { text: string };
    answers: { answer_id: number; poll_media: { text: string } }[];
    results?: {
        is_finalized: boolean;
        answer_counts: { id: number; count: number }[];
    };
};
export function formatPollResults(poll: NativePollResults): string {
    return !poll.results
        ? 'Discord has not supplied poll results yet. Try again later.'
        : `${poll.question.text}\n${poll.results.is_finalized ? 'Finalized tally' : 'Current tally; may change'}\n${poll.answers.map((answer) => `${answer.poll_media.text}: ${poll.results!.answer_counts.find((count) => count.id === answer.answer_id)?.count ?? 0}`).join('\n')}`;
}

export const pollCommand = new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create, close or read a native Discord poll')
    .setContexts(0)
    .setIntegrationTypes(0)
    .addSubcommand((sub) =>
        sub
            .setName('create')
            .setDescription('Managers can create a channel poll')
            .addStringOption((o) =>
                o
                    .setName('question')
                    .setDescription('Poll question')
                    .setMaxLength(300)
                    .setRequired(true)
            )
            .addStringOption((o) =>
                o
                    .setName('answers')
                    .setDescription(
                        'Two to ten distinct answers separated by |'
                    )
                    .setMaxLength(559)
                    .setRequired(true)
            )
            .addIntegerOption((o) =>
                o
                    .setName('hours')
                    .setDescription('Open for 1 to 768 hours')
                    .setMinValue(1)
                    .setMaxValue(768)
            )
            .addBooleanOption((o) =>
                o
                    .setName('multiple')
                    .setDescription('Allow members to select several answers')
            )
    )
    .addSubcommand((sub) =>
        sub
            .setName('close')
            .setDescription('Managers can end a Backline poll early')
            .addStringOption((o) =>
                o
                    .setName('message')
                    .setDescription('Poll message ID in this channel')
                    .setRequired(true)
            )
    )
    .addSubcommand((sub) =>
        sub
            .setName('results')
            .setDescription(
                'Read current results without storing voter identities'
            )
            .addStringOption((o) =>
                o
                    .setName('message')
                    .setDescription('Poll message ID in this channel')
                    .setRequired(true)
            )
    )
    .toJSON();

export async function routePolls(interaction: Interaction): Promise<boolean> {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'poll')
        return false;
    if (!interaction.guild) throw new Error('Server required');
    const action = interaction.options.getSubcommand(),
        guildId = interaction.guild.id,
        actorId = interaction.user.id;
    if (action === 'results') {
        const channel = await destination(
            interaction.client,
            guildId,
            actorId,
            interaction.channelId,
            false
        );
        const message = await channel.messages.fetch({
            message: snowflake.parse(
                interaction.options.getString('message', true)
            ),
            force: true,
        });
        if (message.author.id !== interaction.client.user?.id || !message.poll)
            throw new Error('Backline poll unavailable');
        const raw = (await interaction.client.rest.get(
            Routes.channelMessage(channel.id, message.id)
        )) as {
            poll?: {
                question: { text: string };
                answers: { answer_id: number; poll_media: { text: string } }[];
                results?: {
                    is_finalized: boolean;
                    answer_counts: { id: number; count: number }[];
                };
            };
        };
        const poll = raw.poll;
        if (!poll) throw new Error('Poll unavailable');
        await interaction.editReply({
            content: formatPollResults(poll),
            allowedMentions: { parse: [] },
        });
    } else {
        const data =
            action === 'create'
                ? {
                      action,
                      channelId: interaction.channelId,
                      question: interaction.options.getString('question', true),
                      answers: interaction.options
                          .getString('answers', true)
                          .split('|'),
                      duration: interaction.options.getInteger('hours') ?? 24,
                      multiselect:
                          interaction.options.getBoolean('multiple') ?? false,
                  }
                : {
                      action: 'close',
                      channelId: interaction.channelId,
                      messageId: interaction.options.getString('message', true),
                  };
        const job = await queuePoll(
            interaction.client,
            guildId,
            actorId,
            interaction.id,
            data
        );
        await interaction.editReply(
            `Poll action queued: ${job.id}. Check the channel for delivery; a queued action does not confirm a poll was sent.`
        );
    }
    return true;
}
