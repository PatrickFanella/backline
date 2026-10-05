import { DurableJob, Prisma } from '@prisma/client';
import {
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

import {
    localSchedule,
    resolveLocalTime,
    scheduledUtilitiesConfig,
} from './utilityTime';

export const scheduledInput = localSchedule
    .extend({
        kind: z.enum(['REMINDER', 'ANNOUNCEMENT']),
        channelId: z.string().regex(/^\d{17,20}$/),
        content: z.string().trim().min(1).max(1800),
    })
    .strict();

async function destination(
    client: Client,
    guildId: string,
    actorId: string,
    channelId: string,
    kind: string
) {
    if (!(await moduleRegistry.enabled(guildId, 'scheduled-utilities')))
        throw new Error('Scheduled utilities disabled');
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
    if (
        actor.user.bot ||
        account?.role === 'BANNED' ||
        !channel ||
        ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(
            channel.type
        )
    )
        throw new Error('Destination or member unavailable');
    if (!channel.permissionsFor(actor)?.has(PermissionFlagsBits.ViewChannel))
        throw new Error('Destination access denied');
    if (kind === 'ANNOUNCEMENT') {
        if (!actor.permissions.has(PermissionFlagsBits.ManageGuild))
            throw new Error('Manage Server required');
    } else if (
        !channel.permissionsFor(actor)?.has(PermissionFlagsBits.SendMessages)
    )
        throw new Error('Member cannot send in this channel');
    if (
        !channel
            .permissionsFor(bot)
            ?.has([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
            ])
    )
        throw new Error('Bot cannot send in this channel');
    if (
        channel.type !== ChannelType.GuildText &&
        channel.type !== ChannelType.GuildAnnouncement
    )
        throw new Error('Text channel required');
    return channel;
}

async function current(tx: Prisma.TransactionClient, guildId: string) {
    const installation = await tx.guildInstallation.findUnique({
        where: { guildId },
    });
    const settings = await tx.guildModuleConfig.findUnique({
        where: {
            guildId_moduleId: { guildId, moduleId: 'scheduled-utilities' },
        },
    });
    if (
        !installation?.active ||
        !settings?.enabled ||
        settings.version !== 1 ||
        !scheduledUtilitiesConfig.safeParse(settings.config).success
    )
        throw new Error('Scheduled utilities disabled');
}

export async function scheduleUtility(
    client: Client,
    guildId: string,
    actorId: string,
    requestId: string,
    input: unknown
) {
    if (!requestId || requestId.length > 100)
        throw new Error('Invalid request');
    const parsed = scheduledInput.parse(input),
        runAt = resolveLocalTime({
            local: parsed.local,
            timeZone: parsed.timeZone,
            disambiguation: parsed.disambiguation,
        });
    if (
        runAt.getTime() < Date.now() + 10000 ||
        runAt.getTime() > Date.now() + 30 * 86400000
    )
        throw new Error('Choose a future time within thirty days');
    await destination(client, guildId, actorId, parsed.channelId, parsed.kind);
    return db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
        );
        await current(tx, guildId);
        const previous = await tx.scheduledUtility.findUnique({
            where: { guildId_requestId: { guildId, requestId } },
        });
        if (previous) {
            if (previous.actorId !== actorId)
                throw new Error('Request belongs to another member');
            return previous;
        }
        if (
            (await tx.scheduledUtility.count({ where: { guildId } })) >= 1000 ||
            (await tx.scheduledUtility.count({
                where: {
                    guildId,
                    state: { in: ['PENDING', 'STARTED', 'UNCERTAIN'] },
                },
            })) >= 100 ||
            (await tx.scheduledUtility.count({
                where: { guildId, actorId, state: 'PENDING' },
            })) >= 10
        )
            throw new Error('Schedule capacity reached');
        if (
            (await tx.durableJob.count({
                where: {
                    guildId,
                    state: { in: ['PENDING', 'LEASED', 'RECONCILE'] },
                },
            })) >= 1000
        )
            throw new Error('Server action capacity reached');
        const event = await tx.scheduledUtility.create({
            data: {
                guildId,
                actorId,
                requestId,
                kind: parsed.kind,
                channelId: parsed.channelId,
                content: parsed.content,
                localTime: parsed.local,
                timeZone: parsed.timeZone,
                runAt,
                expiresAt: new Date(runAt.getTime() + 86400000),
            },
        });
        await tx.durableJob.create({
            data: {
                guildId,
                actorId,
                moduleId: 'scheduled-utilities',
                kind: 'scheduled-utility',
                idempotencyKey: 'scheduled-utility:' + event.id,
                payload: { eventId: event.id },
                runAt,
                expiresAt: event.expiresAt,
            },
        });
        return event;
    });
}

export async function cancelUtility(
    client: Client,
    guildId: string,
    actorId: string,
    eventId: string
) {
    const event = await db.scheduledUtility.findFirst({
        where: { id: eventId, guildId },
    });
    if (!event) throw new Error('Scheduled event unavailable');
    if (event.actorId !== actorId)
        await destination(
            client,
            guildId,
            actorId,
            event.channelId,
            'ANNOUNCEMENT'
        );
    else
        await destination(
            client,
            guildId,
            actorId,
            event.channelId,
            event.kind
        );
    return db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
        );
        const changed = await tx.scheduledUtility.updateMany({
            where: { id: eventId, guildId, state: 'PENDING' },
            data: { state: 'CANCELLED', content: '' },
        });
        if (!changed.count)
            throw new Error('Only pending events can be cancelled');
        await tx.durableJob.updateMany({
            where: {
                guildId,
                idempotencyKey: 'scheduled-utility:' + eventId,
                state: 'PENDING',
            },
            data: { state: 'CANCELLED', lastError: 'Cancelled by member' },
        });
    });
}

async function eventFor(job: DurableJob) {
    const payload = z
        .object({ eventId: z.string().uuid() })
        .strict()
        .parse(job.payload);
    return db.scheduledUtility.findFirst({
        where: {
            id: payload.eventId,
            guildId: job.guildId,
            actorId: job.actorId,
        },
    });
}

export function scheduledUtilityHandler(client: Client): JobHandler {
    return {
        authorize: async (job) => {
            const event = await eventFor(job);
            if (
                !event ||
                event.state === 'CANCELLED' ||
                event.expiresAt <= new Date()
            )
                return false;
            await destination(
                client,
                event.guildId,
                event.actorId,
                event.channelId,
                event.kind
            );
            return true;
        },
        execute: async (job) => {
            const event = await eventFor(job);
            if (!event)
                return { state: 'CANCELLED', reason: 'Schedule unavailable' };
            const channel = await destination(
                client,
                event.guildId,
                event.actorId,
                event.channelId,
                event.kind
            );
            return db.$transaction(
                async (tx) => {
                    await tx.$queryRaw(
                        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${job.guildId})::bigint)::text`
                    );
                    await current(tx, job.guildId);
                    const fresh = await tx.scheduledUtility.findUniqueOrThrow({
                        where: { id: event.id },
                    });
                    if (fresh.state === 'DELIVERED' && fresh.messageId)
                        return {
                            state: 'DELIVERED',
                            result: {
                                messageId: fresh.messageId,
                                eventId: fresh.id,
                            },
                        };
                    if (fresh.state !== 'PENDING')
                        return {
                            state: 'RECONCILE',
                            reason: 'Prior delivery requires readback',
                        };
                    if (
                        fresh.runAt > new Date() ||
                        fresh.expiresAt <= new Date()
                    )
                        return {
                            state: 'CANCELLED',
                            reason: 'Outside delivery window',
                        };
                    await tx.scheduledUtility.update({
                        where: { id: fresh.id },
                        data: { state: 'STARTED' },
                    });
                    try {
                        const message = await channel.send({
                            content:
                                fresh.kind === 'REMINDER'
                                    ? `<@${fresh.actorId}> Reminder: ${fresh.content}`
                                    : fresh.content,
                            allowedMentions: {
                                parse: [],
                                users:
                                    fresh.kind === 'REMINDER'
                                        ? [fresh.actorId]
                                        : [],
                                repliedUser: false,
                            },
                        });
                        await tx.scheduledUtility.update({
                            where: { id: fresh.id },
                            data: { state: 'DELIVERED', messageId: message.id },
                        });
                        return {
                            state: 'DELIVERED',
                            result: {
                                messageId: message.id,
                                eventId: fresh.id,
                            },
                        };
                    } catch {
                        await tx.scheduledUtility.update({
                            where: { id: fresh.id },
                            data: { state: 'UNCERTAIN' },
                        });
                        return {
                            state: 'RECONCILE',
                            reason: 'Discord send outcome uncertain; do not resend automatically',
                        };
                    }
                },
                { timeout: 60000 }
            );
        },
        reconcile: async (job) => {
            const event = await eventFor(job);
            if (!event?.messageId || event.state !== 'DELIVERED')
                return {
                    state: 'RECONCILE',
                    reason: 'Message receipt unavailable; manual investigation required',
                };
            const channel = await destination(
                client,
                event.guildId,
                event.actorId,
                event.channelId,
                event.kind
            );
            const message = await channel.messages.fetch({
                message: event.messageId,
                force: true,
            });
            if (message.author.id !== client.user?.id)
                return {
                    state: 'RECONCILE',
                    reason: 'Message authorship mismatch',
                };
            return {
                state: 'DELIVERED',
                result: { eventId: event.id, messageId: message.id },
            };
        },
    };
}

export async function expireScheduledUtilities() {
    const pending = await db.scheduledUtility.findMany({
        where: { state: 'PENDING', runAt: { lte: new Date() } },
        take: 100,
    });
    for (const event of pending)
        await db.$transaction(async (tx) => {
            await tx.$queryRaw(
                Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${event.guildId})::bigint)::text`
            );
            const job = await tx.durableJob.findUnique({
                where: {
                    guildId_idempotencyKey: {
                        guildId: event.guildId,
                        idempotencyKey: 'scheduled-utility:' + event.id,
                    },
                },
            });
            if (
                job?.state === 'CANCELLED' ||
                job?.state === 'FAILED' ||
                (event.expiresAt <= new Date() && job?.state !== 'LEASED')
            ) {
                await tx.scheduledUtility.updateMany({
                    where: { id: event.id, state: 'PENDING' },
                    data: {
                        state:
                            event.expiresAt <= new Date()
                                ? 'EXPIRED'
                                : job!.state,
                        content: '',
                    },
                });
            }
        });

    const expired = await db.scheduledUtility.findMany({
        where: { expiresAt: { lt: new Date(Date.now() - 30 * 86400000) } },
        take: 100,
        select: { id: true, guildId: true },
    });
    for (const event of expired)
        await db.$transaction(async (tx) => {
            await tx.$queryRaw(
                Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${event.guildId})::bigint)::text`
            );
            await tx.durableJob.deleteMany({
                where: {
                    guildId: event.guildId,
                    kind: 'scheduled-utility',
                    idempotencyKey: 'scheduled-utility:' + event.id,
                    state: { not: 'LEASED' },
                },
            });
            const leased = await tx.durableJob.count({
                where: {
                    guildId: event.guildId,
                    idempotencyKey: 'scheduled-utility:' + event.id,
                    state: 'LEASED',
                },
            });
            if (!leased)
                await tx.scheduledUtility.deleteMany({
                    where: { id: event.id, guildId: event.guildId },
                });
        });
}

export const scheduledUtilityCommands = ['remind', 'announce'].map((name) => {
    const command = new SlashCommandBuilder()
        .setName(name)
        .setDescription(
            name === 'remind'
                ? 'Schedule a reminder in this channel'
                : 'Schedule a server announcement'
        )
        .setContexts(0)
        .setIntegrationTypes(0);
    if (name === 'announce')
        command.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
    command.addSubcommand((sub) =>
        sub
            .setName('create')
            .setDescription('Schedule one message within thirty days')
            .addStringOption((o) =>
                o
                    .setName('time')
                    .setDescription('Local time YYYY-MM-DDTHH:mm')
                    .setRequired(true)
            )
            .addStringOption((o) =>
                o
                    .setName('timezone')
                    .setDescription('IANA zone, such as America/Chicago')
                    .setRequired(true)
            )
            .addStringOption((o) =>
                o
                    .setName('message')
                    .setDescription('Message text, up to 1800 characters')
                    .setMaxLength(1800)
                    .setRequired(true)
            )
            .addStringOption((o) =>
                o
                    .setName('ambiguity')
                    .setDescription(
                        'Choose explicitly for a repeated daylight-saving time'
                    )
                    .addChoices(
                        { name: 'Earlier', value: 'earlier' },
                        { name: 'Later', value: 'later' }
                    )
            )
    );
    command.addSubcommand((sub) =>
        sub
            .setName('list')
            .setDescription('List your ten most recent scheduled messages')
    );
    command.addSubcommand((sub) =>
        sub
            .setName('cancel')
            .setDescription('Cancel a pending scheduled message')
            .addStringOption((o) =>
                o
                    .setName('id')
                    .setDescription('Scheduled event ID')
                    .setRequired(true)
            )
    );
    return command.toJSON();
});

export async function routeScheduledUtilities(
    interaction: Interaction
): Promise<boolean> {
    if (
        !interaction.isChatInputCommand() ||
        !['remind', 'announce'].includes(interaction.commandName)
    )
        return false;
    if (
        !interaction.guild ||
        !(await moduleRegistry.enabled(
            interaction.guild.id,
            'scheduled-utilities'
        ))
    ) {
        await interaction.editReply(
            'Scheduled utilities are disabled for this server.'
        );
        return true;
    }
    const guildId = interaction.guild.id,
        actorId = interaction.user.id;
    const kind =
        interaction.commandName === 'announce' ? 'ANNOUNCEMENT' : 'REMINDER';
    await destination(
        interaction.client,
        guildId,
        actorId,
        interaction.channelId,
        kind
    );
    const action = interaction.options.getSubcommand();
    if (action === 'create') {
        try {
            resolveLocalTime({
                local: interaction.options.getString('time', true),
                timeZone: interaction.options.getString('timezone', true),
                disambiguation: (interaction.options.getString('ambiguity') ??
                    'reject') as 'reject' | 'earlier' | 'later',
            });
        } catch (error) {
            await interaction.editReply(
                error instanceof z.ZodError
                    ? 'Use YYYY-MM-DDTHH:mm and an IANA time zone.'
                    : error instanceof Error
                      ? error.message
                      : 'Invalid schedule'
            );
            return true;
        }

        const event = await scheduleUtility(
            interaction.client,
            guildId,
            actorId,
            interaction.id,
            {
                kind,
                channelId: interaction.channelId,
                content: interaction.options.getString('message', true),
                local: interaction.options.getString('time', true),
                timeZone: interaction.options.getString('timezone', true),
                disambiguation:
                    interaction.options.getString('ambiguity') ?? 'reject',
            }
        );
        await interaction.editReply(
            `Scheduled ${event.id} for <t:${Math.floor(event.runAt.getTime() / 1000)}:F>. ${kind === 'REMINDER' ? 'This reminder will mention you in this channel.' : 'Mentions will not notify members; announcement messages are not automatically cross-posted.'}`
        );
    } else if (action === 'cancel') {
        await cancelUtility(
            interaction.client,
            guildId,
            actorId,
            interaction.options.getString('id', true)
        );
        await interaction.editReply('Pending message cancelled.');
    } else {
        const rows = await db.scheduledUtility.findMany({
            where: { guildId, actorId, kind },
            orderBy: { createdAt: 'desc' },
            take: 10,
        });
        await interaction.editReply(
            rows.length
                ? rows
                      .map(
                          (row) =>
                              `${row.id} · ${row.state} · <t:${Math.floor(row.runAt.getTime() / 1000)}:F>`
                      )
                      .join('\n')
                : 'You have no scheduled messages of this kind.'
        );
    }
    return true;
}
