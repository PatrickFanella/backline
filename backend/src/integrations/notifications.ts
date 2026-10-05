import { DurableJob, Prisma, ProviderFeed } from '@prisma/client';
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

import { pollProvider, ProviderItem, ProviderSource } from './adapters';
import { feedInput, providerSource } from './config';

async function current(tx: Prisma.TransactionClient, guildId: string) {
    const installation = await tx.guildInstallation.findUnique({
            where: { guildId },
        }),
        settings = await tx.guildModuleConfig.findUnique({
            where: { guildId_moduleId: { guildId, moduleId: 'integrations' } },
        });
    if (!installation?.active || !settings?.enabled || settings.version !== 1)
        throw new Error('Integrations disabled');
}
async function destination(
    client: Client,
    guildId: string,
    actorId: string,
    channelId: string
) {
    if (!(await moduleRegistry.enabled(guildId, 'integrations')))
        throw new Error('Integrations disabled');
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
        !actor.permissions.has(PermissionFlagsBits.ManageGuild) ||
        !channel ||
        ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(
            channel.type
        ) ||
        !channel.permissionsFor(actor)?.has(PermissionFlagsBits.ViewChannel) ||
        !channel
            .permissionsFor(bot)
            ?.has([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
            ])
    )
        throw new Error('Current manager and destination permissions required');
    if (
        channel.type !== ChannelType.GuildText &&
        channel.type !== ChannelType.GuildAnnouncement
    )
        throw new Error('Text channel required');
    return channel;
}
export async function addFeed(
    client: Client,
    guildId: string,
    actorId: string,
    input: unknown
) {
    const parsed = feedInput.parse(input);
    await destination(client, guildId, actorId, parsed.channelId);
    return db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
        );
        await current(tx, guildId);
        const prior = await tx.providerFeed.findUnique({
            where: {
                guildId_provider_source: { guildId, ...parsed.subscription },
            },
        });
        if (prior) {
            if (prior.enabled)
                throw new Error(
                    'Feed already configured; remove it before changing destination'
                );
            return tx.providerFeed.update({
                where: { id: prior.id },
                data: {
                    enabled: true,
                    actorId,
                    channelId: parsed.channelId,
                    nextPollAt: new Date(),
                    failures: 0,
                    lastError: null,
                },
            });
        }
        if ((await tx.providerFeed.count({ where: { guildId } })) >= 20)
            throw new Error('Feed capacity reached');
        return tx.providerFeed.create({
            data: {
                guildId,
                actorId,
                channelId: parsed.channelId,
                ...parsed.subscription,
            },
        });
    });
}
export async function removeFeed(
    client: Client,
    guildId: string,
    actorId: string,
    id: string
) {
    const feed = await db.providerFeed.findFirstOrThrow({
        where: { id, guildId },
    });
    await destination(client, guildId, actorId, feed.channelId);
    await db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
        );
        await tx.providerFeed.update({
            where: { id },
            data: { enabled: false },
        });
        const pending = await tx.providerEvent.findMany({
            where: { feedId: id, state: 'PENDING' },
            select: { id: true },
        });
        await tx.providerEvent.updateMany({
            where: { feedId: id, state: 'PENDING' },
            data: { state: 'CANCELLED' },
        });
        await tx.durableJob.updateMany({
            where: {
                guildId,
                state: 'PENDING',
                idempotencyKey: {
                    in: pending.map((row) => 'provider-event:' + row.id),
                },
            },
            data: { state: 'CANCELLED', lastError: 'Feed removed' },
        });
    });
}
export async function recordProviderItems(
    feed: ProviderFeed,
    items: ProviderItem[],
    now = new Date()
) {
    items = z
        .array(
            z.object({
                id: z.string().regex(/^[a-f0-9]{64}$/),
                title: z.string().max(200),
                url: z
                    .string()
                    .url()
                    .max(1000)
                    .refine((value) => new URL(value).protocol === 'https:'),
                publishedAt: z.date(),
            })
        )
        .max(100)
        .parse(items);
    return db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${feed.guildId})::bigint)::text`
        );
        await current(tx, feed.guildId);
        const fresh = await tx.providerFeed.findUniqueOrThrow({
            where: { id: feed.id },
        });
        if (!fresh.enabled) return;
        if (
            (await tx.providerEvent.count({
                where: { guildId: feed.guildId },
            })) >= 5000
        )
            throw new Error('Provider receipt capacity reached');
        const active = await tx.durableJob.count({
            where: {
                guildId: feed.guildId,
                state: { in: ['PENDING', 'LEASED', 'RECONCILE'] },
            },
        });
        if (active + items.length > 1000)
            throw new Error('Server job capacity reached');
        for (const item of items.slice(0, 100)) {
            if (item.publishedAt > now) continue;
            if (
                await tx.providerEvent.findUnique({
                    where: {
                        feedId_externalId: {
                            feedId: feed.id,
                            externalId: item.id,
                        },
                    },
                })
            )
                continue;
            const notify =
                !!fresh.baselineAt &&
                item.publishedAt > fresh.baselineAt &&
                item.publishedAt <= now &&
                item.publishedAt.getTime() > now.getTime() - 86400000;
            const event = await tx.providerEvent.create({
                data: {
                    guildId: feed.guildId,
                    feedId: feed.id,
                    externalId: item.id,
                    title: item.title,
                    url: item.url,
                    publishedAt: item.publishedAt,
                    state: notify ? 'PENDING' : 'BASELINE',
                },
            });
            if (notify)
                await tx.durableJob.create({
                    data: {
                        guildId: feed.guildId,
                        actorId: fresh.actorId,
                        moduleId: 'integrations',
                        kind: 'provider-notification',
                        idempotencyKey: 'provider-event:' + event.id,
                        payload: { eventId: event.id },
                        runAt: now,
                        expiresAt: new Date(now.getTime() + 86400000),
                    },
                });
        }
        await tx.providerFeed.update({
            where: { id: feed.id },
            data: {
                baselineAt: fresh.baselineAt ?? now,
                failures: 0,
                lastError: null,
                nextPollAt: new Date(
                    now.getTime() +
                        (feed.provider === 'twitch' ? 120000 : 900000)
                ),
            },
        });
    });
}
let feedCursor: string | undefined;
export async function maintainProviderFeeds(
    adapter: (input: ProviderSource) => Promise<ProviderItem[]> = pollProvider,
    now = new Date()
) {
    await expireProviderEvents(now);
    const feeds = await db.providerFeed.findMany({
        where: {
            enabled: true,
            nextPollAt: { lte: now },
            ...(feedCursor ? { id: { gt: feedCursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: 10,
    });
    feedCursor = feeds.length === 10 ? feeds[9].id : undefined;
    for (const feed of feeds) {
        if (!(await moduleRegistry.enabled(feed.guildId, 'integrations')))
            continue;
        // Atomically claim the poll window before contacting a provider; stale results are deduplicated.
        const claimed = await db.providerFeed.updateMany({
            where: { id: feed.id, enabled: true, nextPollAt: { lte: now } },
            data: { nextPollAt: new Date(now.getTime() + 120000) },
        });
        if (!claimed.count) continue;
        try {
            await recordProviderItems(
                feed,
                await adapter(
                    providerSource.parse({
                        provider: feed.provider,
                        source: feed.source,
                    })
                ),
                now
            );
        } catch {
            await db.providerFeed.updateMany({
                where: { id: feed.id, enabled: true },
                data: {
                    failures: { increment: 1 },
                    lastError: 'Provider unavailable; retry scheduled',
                    nextPollAt: new Date(
                        now.getTime() +
                            Math.min(
                                21600000,
                                120000 * 2 ** Math.min(feed.failures, 8)
                            )
                    ),
                },
            });
        }
    }
}
export function providerNotificationHandler(client: Client): JobHandler {
    async function eventFor(job: DurableJob) {
        const payload = z
            .object({ eventId: z.string().uuid() })
            .strict()
            .parse(job.payload);
        const event = await db.providerEvent.findFirst({
            where: { id: payload.eventId, guildId: job.guildId },
        });
        const feed = event
            ? await db.providerFeed.findFirst({
                  where: { id: event.feedId, guildId: job.guildId },
              })
            : null;
        return { event, feed };
    }
    return {
        authorize: async (job) => {
            const { event, feed } = await eventFor(job);
            if (!event || !feed?.enabled || event.state === 'CANCELLED')
                return false;
            await destination(
                client,
                job.guildId,
                feed.actorId,
                feed.channelId
            );
            return true;
        },
        execute: async (job) => {
            const { event, feed } = await eventFor(job);
            if (!event || !feed)
                return { state: 'CANCELLED', reason: 'Feed unavailable' };
            const channel = await destination(
                client,
                job.guildId,
                feed.actorId,
                feed.channelId
            );
            return db.$transaction(
                async (tx) => {
                    await tx.$queryRaw(
                        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${job.guildId})::bigint)::text`
                    );
                    await current(tx, job.guildId);
                    const fresh = await tx.providerEvent.findUniqueOrThrow({
                            where: { id: event.id },
                        }),
                        currentFeed = await tx.providerFeed.findUniqueOrThrow({
                            where: { id: feed.id },
                        });
                    if (!currentFeed.enabled || fresh.state === 'CANCELLED')
                        return { state: 'CANCELLED', reason: 'Feed removed' };
                    if (fresh.state === 'DELIVERED' && fresh.messageId)
                        return {
                            state: 'DELIVERED',
                            result: { messageId: fresh.messageId },
                        };
                    if (fresh.state !== 'PENDING')
                        return {
                            state: 'RECONCILE',
                            reason: 'Prior send requires investigation',
                        };
                    if (job.expiresAt && job.expiresAt <= new Date())
                        return {
                            state: 'CANCELLED',
                            reason: 'Notification expired',
                        };
                    try {
                        const message = await channel.send({
                            content: `${feed.provider}: ${fresh.title.replace(/@/g, '＠').replace(/[\\*_~`>|]/g, '')}\n<${fresh.url}>`,
                            allowedMentions: {
                                parse: [],
                                users: [],
                                repliedUser: false,
                            },
                        });
                        await tx.providerEvent.update({
                            where: { id: fresh.id },
                            data: { state: 'DELIVERED', messageId: message.id },
                        });
                        return {
                            state: 'DELIVERED',
                            result: { messageId: message.id },
                        };
                    } catch {
                        await tx.providerEvent.update({
                            where: { id: fresh.id },
                            data: { state: 'UNCERTAIN' },
                        });
                        return {
                            state: 'RECONCILE',
                            reason: 'Notification send uncertain; inspect destination',
                        };
                    }
                },
                { timeout: 60000 }
            );
        },
        reconcile: async (job) => {
            const { event, feed } = await eventFor(job);
            if (!event?.messageId || !feed)
                return {
                    state: 'RECONCILE',
                    reason: 'Notification receipt unavailable',
                };
            const channel = await destination(
                client,
                job.guildId,
                feed.actorId,
                feed.channelId
            );
            const message = await channel.messages.fetch({
                message: event.messageId,
                force: true,
            });
            return message.author.id === client.user?.id
                ? { state: 'DELIVERED', result: { messageId: message.id } }
                : { state: 'RECONCILE', reason: 'Message authorship mismatch' };
        },
    };
}
export const feedCommand = new SlashCommandBuilder()
    .setName('feed')
    .setDescription('Manage Twitch, YouTube and RSS notifications')
    .addSubcommand((s) =>
        s
            .setName('add')
            .setDescription(
                'Connect a source; the first poll establishes a baseline'
            )
            .addStringOption((o) =>
                o
                    .setName('provider')
                    .setDescription('Provider')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Twitch', value: 'twitch' },
                        { name: 'YouTube', value: 'youtube' },
                        { name: 'RSS / Atom', value: 'rss' }
                    )
            )
            .addStringOption((o) =>
                o
                    .setName('source')
                    .setDescription(
                        'Twitch login, YouTube channel ID, or public HTTPS feed URL'
                    )
                    .setRequired(true)
            )
    )
    .addSubcommand((s) =>
        s.setName('list').setDescription('List configured feeds')
    )
    .addSubcommand((s) =>
        s
            .setName('remove')
            .setDescription('Disable a feed and cancel pending notifications')
            .addStringOption((o) =>
                o.setName('id').setDescription('Feed ID').setRequired(true)
            )
    );
export async function routeFeed(interaction: Interaction) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'feed')
        return false;
    await interaction.deferReply({ flags: 64 });
    if (!interaction.guildId) throw new Error('Server command required');
    const guildId = interaction.guildId,
        actorId = interaction.user.id;
    const action = interaction.options.getSubcommand();
    await destination(
        interaction.client,
        guildId,
        actorId,
        interaction.channelId
    );
    if (action === 'add') {
        const feed = await addFeed(interaction.client, guildId, actorId, {
            channelId: interaction.channelId,
            subscription: {
                provider: interaction.options.getString('provider', true),
                source: interaction.options.getString('source', true),
            },
        });
        await interaction.editReply(
            `Feed saved: ${feed.id}. The first successful poll establishes a baseline without sending old items.`
        );
    }
    if (action === 'remove') {
        await removeFeed(
            interaction.client,
            guildId,
            actorId,
            interaction.options.getString('id', true)
        );
        await interaction.editReply(
            'Feed disabled; pending notifications cancelled.'
        );
    }
    if (action === 'list') {
        const feeds = await db.providerFeed.findMany({
            where: { guildId },
            take: 20,
            orderBy: { createdAt: 'desc' },
        });
        await interaction.editReply(
            feeds.length
                ? feeds
                      .map(
                          (f) =>
                              `${f.id}: ${f.provider} ${f.enabled ? 'enabled' : 'disabled'}; ${f.baselineAt ? 'baseline established' : 'awaiting baseline'}; ${f.lastError ?? 'no provider error'}`
                      )
                      .join('\n')
                : 'No feeds configured.'
        );
    }
    return true;
}

export async function expireProviderEvents(now = new Date()) {
    const events = await db.providerEvent.findMany({
        where: {
            createdAt: { lt: new Date(now.getTime() - 90 * 86400000) },
            state: { in: ['BASELINE', 'DELIVERED', 'CANCELLED'] },
        },
        take: 100,
    });
    for (const event of events)
        await db.$transaction(async (tx) => {
            await tx.$queryRaw(
                Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${event.guildId})::bigint)::text`
            );
            const key = 'provider-event:' + event.id;
            if (
                await tx.durableJob.count({
                    where: {
                        guildId: event.guildId,
                        idempotencyKey: key,
                        state: { in: ['LEASED', 'RECONCILE'] },
                    },
                })
            )
                return;
            await tx.jobAttempt.deleteMany({
                where: { job: { guildId: event.guildId, idempotencyKey: key } },
            });
            await tx.durableJob.deleteMany({
                where: { guildId: event.guildId, idempotencyKey: key },
            });
            await tx.providerEvent.deleteMany({
                where: {
                    id: event.id,
                    state: { in: ['BASELINE', 'DELIVERED', 'CANCELLED'] },
                },
            });
        });
}
