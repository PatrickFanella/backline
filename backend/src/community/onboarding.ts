import { createHash, randomUUID } from 'crypto';

import { Prisma, MemberJourney } from '@prisma/client';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Client,
    DiscordAPIError,
    EmbedBuilder,
    GuildMember,
    Interaction,
} from 'discord.js';
import { z } from 'zod';

import { db } from '../db';
import { enqueueJob, JobHandler } from '../jobs/store';
import { moduleRegistry } from '../modules/registry';

import { onboardingConfig } from './config';
import { assertAssignableRole } from './roles';

export async function onboardingSettings(guildId: string) {
    if (!(await moduleRegistry.enabled(guildId, 'onboarding'))) return null;
    const config = await db.guildModuleConfig.findUnique({
        where: { guildId_moduleId: { guildId, moduleId: 'onboarding' } },
    });
    return config ? onboardingConfig.parse(config.config) : null;
}
export async function captureJoin(member: GuildMember): Promise<void> {
    if (!member.joinedTimestamp || !(await onboardingSettings(member.guild.id)))
        return;
    const guildId = member.guild.id,
        userId = member.id,
        joinedAt = String(member.joinedTimestamp);
    const record = await db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
        );
        const existing = await tx.memberJourney.findUnique({
            where: { guildId_userId_joinedAt: { guildId, userId, joinedAt } },
        });
        return (
            existing ??
            tx.memberJourney.create({
                data: {
                    guildId,
                    userId,
                    joinedAt,
                    username: member.user.username.slice(0, 100),
                    expiresAt: new Date(Date.now() + 90 * 86400000),
                },
            })
        );
    });
    await queueJourney(record, 'join');
}
async function queueJourney(
    record: MemberJourney,
    kind: 'join' | 'departure' | 'roles'
) {
    const job = await enqueueJob({
        guildId: record.guildId,
        actorId: 'system:onboarding',
        moduleId: 'onboarding',
        kind: `onboarding-${kind}`,
        idempotencyKey: `journey:${kind}:${record.id}`,
        payload: { journeyId: record.id },
        runAt: new Date(),
        expiresAt: new Date(
            Math.min(record.expiresAt.getTime(), Date.now() + 86400000)
        ),
        maxAttempts: 1,
    });
    if (job.state === 'FAILED' || job.state === 'CANCELLED') {
        if (kind === 'join')
            await db.memberJourney.updateMany({
                where: { id: record.id, state: 'PENDING' },
                data: {
                    state: 'SKIPPED',
                    detail: 'Welcome delivery cancelled or failed',
                },
            });
        if (kind === 'departure')
            await db.memberJourney.updateMany({
                where: { id: record.id, departureState: 'PENDING' },
                data: {
                    departureState: 'SKIPPED',
                    detail: 'Departure delivery cancelled or failed',
                },
            });
    }
    return job;
}
async function currentMember(client: Client, record: MemberJourney) {
    const guild = await client.guilds.fetch({
        guild: record.guildId,
        force: true,
    });
    const member = await guild.members.fetch({
        user: record.userId,
        force: true,
    });
    if (String(member.joinedTimestamp) !== record.joinedAt)
        throw new Error('Membership episode changed');
    return { guild, member };
}
async function grantRoles(
    client: Client,
    record: MemberJourney
): Promise<void> {
    const config = await onboardingSettings(record.guildId);
    if (!config) throw new Error('Onboarding disabled');
    if (config.requireRules && !record.acknowledgedAt) {
        await db.memberJourney.update({
            where: { id: record.id },
            data: { rolesState: 'WAITING' },
        });
        return;
    }
    const { guild, member } = await currentMember(client, record);
    const bot = await guild.members.fetchMe({ force: true });
    const roles = [];
    for (const id of config.joinRoles) {
        const role = await guild.roles.fetch(id, { force: true });
        if (!role) throw new Error('Join role unavailable');
        assertAssignableRole(guild, bot, role);
        roles.push(role);
    }
    const reserved = await db.memberJourney.updateMany({
        where: { id: record.id, rolesState: { in: ['PENDING', 'WAITING'] } },
        data: { rolesState: 'SENDING' },
    });
    if (!reserved.count) return;
    try {
        for (const role of roles)
            if (!member.roles.cache.has(role.id))
                await member.roles.add(
                    role.id,
                    'Backline eligible onboarding role'
                );
        await db.memberJourney.update({
            where: { id: record.id },
            data: { rolesState: 'DELIVERED' },
        });
    } catch {
        await db.memberJourney.update({
            where: { id: record.id },
            data: {
                rolesState: 'UNCERTAIN',
                detail: 'Role assignment incomplete; inspect current roles',
            },
        });
        throw new Error('Role outcome uncertain');
    }
}
function render(template: string, username: string, server: string) {
    return template
        .replace(/\{user\}/g, username)
        .replace(/\{server\}/g, server)
        .slice(0, 2000);
}
export function onboardingHandler(
    client: Client,
    kind: 'join' | 'departure' | 'roles'
): JobHandler {
    return {
        authorize: (job) => moduleRegistry.enabled(job.guildId, 'onboarding'),
        execute: async (job) => {
            const { journeyId } = z
                .object({ journeyId: z.string() })
                .parse(job.payload);
            let record = await db.memberJourney.findFirst({
                where: {
                    id: journeyId,
                    guildId: job.guildId,
                    expiresAt: { gt: new Date() },
                },
            });
            if (!record)
                return {
                    state: 'CANCELLED',
                    reason: 'Membership record expired',
                };
            const config = await onboardingSettings(job.guildId);
            if (!config)
                return { state: 'CANCELLED', reason: 'Onboarding disabled' };
            if (kind === 'roles') {
                try {
                    await grantRoles(client, record);
                    record = await db.memberJourney.findUniqueOrThrow({
                        where: { id: record.id },
                    });
                    return record.rolesState === 'DELIVERED'
                        ? {
                              state: 'DELIVERED',
                              result: {
                                  journeyId: record.id,
                                  rolesState: record.rolesState,
                              },
                          }
                        : {
                              state: 'RECONCILE',
                              reason: 'Role outcome unavailable',
                          };
                } catch {
                    const denied = await db.memberJourney.updateMany({
                        where: {
                            id: record.id,
                            rolesState: { in: ['PENDING', 'WAITING'] },
                        },
                        data: {
                            rolesState: 'FAILED',
                            detail: 'Current role authorization unavailable',
                        },
                    });
                    return {
                        state: denied.count ? 'FAILED' : 'RECONCILE',
                        reason: 'Role assignment requires investigation',
                    };
                }
            }
            const state =
                kind === 'join' ? record.state : record.departureState;
            if (state === 'DELIVERED')
                return {
                    state: 'DELIVERED',
                    result: {
                        journeyId: record.id,
                        messageId:
                            kind === 'join'
                                ? record.welcomeMessageId
                                : record.departureMessageId,
                    },
                };
            if (state !== 'PENDING')
                return {
                    state: 'RECONCILE',
                    reason: 'Onboarding send already reserved',
                };
            const guild = await client.guilds.fetch({
                guild: job.guildId,
                force: true,
            });
            if (kind === 'join') {
                if (record.leftAt)
                    return {
                        state: 'CANCELLED',
                        reason: 'Member already left',
                    };
                try {
                    await grantRoles(client, record);
                } catch {
                    await db.memberJourney.updateMany({
                        where: {
                            id: record.id,
                            rolesState: { in: ['PENDING', 'WAITING'] },
                        },
                        data: {
                            rolesState: 'FAILED',
                            detail: 'Join roles unavailable or incomplete',
                        },
                    });
                }
                await currentMember(client, record);
            } else if (!record.leftAt)
                return { state: 'CANCELLED', reason: 'Departure not recorded' };
            const channelId =
                kind === 'join' ? config.channelId : config.departureChannelId;
            const messageText =
                kind === 'join' ? config.welcome : config.departure;
            if (!channelId || !messageText) {
                await db.memberJourney.update({
                    where: { id: record.id },
                    data:
                        kind === 'join'
                            ? { state: 'DELIVERED' }
                            : { departureState: 'DELIVERED' },
                });
                return {
                    state: 'DELIVERED',
                    result: { journeyId: record.id, notificationSent: false },
                };
            }
            const channel = await guild.channels.fetch(channelId);
            if (!channel || !channel.isTextBased() || !('send' in channel))
                return {
                    state: 'FAILED',
                    reason: 'Onboarding channel unavailable',
                };
            const reserved = await db.memberJourney.updateMany({
                where: {
                    id: record.id,
                    ...(kind === 'join'
                        ? { state: 'PENDING' }
                        : { departureState: 'PENDING' }),
                },
                data:
                    kind === 'join'
                        ? {
                              state: 'SENDING',
                              welcomeChannelId: channelId,
                              rulesHash: config.requireRules
                                  ? createHash('sha256')
                                        .update(config.rules)
                                        .digest('hex')
                                  : null,
                          }
                        : { departureState: 'SENDING' },
            });
            if (!reserved.count)
                return {
                    state: 'RECONCILE',
                    reason: 'Onboarding send already reserved',
                };
            try {
                const embed = new EmbedBuilder()
                    .setTitle(kind === 'join' ? 'Welcome' : 'Member departure')
                    .setDescription(
                        render(messageText, record.username, guild.name)
                    );
                if (kind === 'join' && config.requireRules)
                    embed.addFields({
                        name: 'Server rules',
                        value: config.rules.slice(0, 1024),
                    });
                const components =
                    kind === 'join' && config.requireRules
                        ? [
                              new ActionRowBuilder<ButtonBuilder>().addComponents(
                                  new ButtonBuilder()
                                      .setCustomId(
                                          `backline:rules:${record.id}`
                                      )
                                      .setLabel('Acknowledge rules')
                                      .setStyle(ButtonStyle.Primary)
                              ),
                          ]
                        : [];
                const message = await channel.send({
                    embeds: [embed],
                    components,
                    allowedMentions: { parse: [] },
                    nonce: randomUUID().replace(/-/g, '').slice(0, 24),
                    enforceNonce: true,
                });
                await db.memberJourney.update({
                    where: { id: record.id },
                    data:
                        kind === 'join'
                            ? {
                                  state: 'DELIVERED',
                                  welcomeMessageId: message.id,
                              }
                            : {
                                  departureState: 'DELIVERED',
                                  departureMessageId: message.id,
                              },
                });
                return {
                    state: 'DELIVERED',
                    result: { journeyId: record.id, messageId: message.id },
                };
            } catch (error) {
                const rejected =
                    error instanceof DiscordAPIError &&
                    error.status >= 400 &&
                    error.status < 500;
                await db.memberJourney.update({
                    where: { id: record.id },
                    data: {
                        ...(kind === 'join'
                            ? { state: rejected ? 'FAILED' : 'UNCERTAIN' }
                            : {
                                  departureState: rejected
                                      ? 'FAILED'
                                      : 'UNCERTAIN',
                              }),
                        detail: rejected
                            ? 'Discord rejected onboarding message'
                            : 'Message outcome uncertain',
                    },
                });
                return {
                    state: rejected ? 'FAILED' : 'RECONCILE',
                    reason: 'Onboarding delivery unavailable',
                };
            }
        },
        reconcile: async (job) => {
            const { journeyId } = z
                .object({ journeyId: z.string() })
                .parse(job.payload);
            const record = await db.memberJourney.findFirst({
                where: { id: journeyId, guildId: job.guildId },
            });
            const delivered =
                record &&
                (kind === 'roles'
                    ? record.rolesState === 'DELIVERED'
                    : kind === 'join'
                      ? record.state === 'DELIVERED'
                      : record.departureState === 'DELIVERED');
            return delivered
                ? { state: 'DELIVERED', result: { journeyId } }
                : { state: 'RECONCILE', reason: 'Delivery not proven' };
        },
    };
}
export async function acknowledgeRules(
    interaction: Interaction
): Promise<boolean> {
    if (
        !interaction.isButton() ||
        !interaction.customId.startsWith('backline:rules:')
    )
        return false;
    const id = interaction.customId.slice('backline:rules:'.length);
    const record = await db.memberJourney.findFirst({
        where: {
            id,
            guildId: interaction.guildId!,
            userId: interaction.user.id,
            leftAt: null,
            expiresAt: { gt: new Date() },
            welcomeMessageId: interaction.message.id,
        },
    });
    const config = record ? await onboardingSettings(record.guildId) : null;
    if (
        !record ||
        !config?.requireRules ||
        record.rulesHash !==
            createHash('sha256').update(config.rules).digest('hex')
    ) {
        await interaction.editReply(
            'This acknowledgment is unavailable for your current membership.'
        );
        return true;
    }
    await currentMember(interaction.client, record);
    await db.memberJourney.updateMany({
        where: { id: record.id, acknowledgedAt: null },
        data: { acknowledgedAt: new Date() },
    });
    const job = await queueJourney(record, 'roles');
    await interaction.editReply(
        `Rules acknowledged. Join-role action: ${job.state}. Assignment is checked separately.`
    );
    return true;
}
export function registerOnboardingEvents(client: Client) {
    client.on('guildMemberAdd', (member) => {
        void captureJoin(member).catch(() =>
            console.warn('Onboarding capture failed')
        );
    });
    client.on('guildMemberRemove', (member) => {
        void (async () => {
            if (!(await onboardingSettings(member.guild.id))) return;
            const record = await db.memberJourney.findFirst({
                where: {
                    guildId: member.guild.id,
                    userId: member.id,
                    ...(member.joinedTimestamp
                        ? { joinedAt: String(member.joinedTimestamp) }
                        : {}),
                },
                orderBy: { createdAt: 'desc' },
            });
            if (!record) return;
            await db.memberJourney.updateMany({
                where: { id: record.id, leftAt: null },
                data: { leftAt: new Date() },
            });
            await queueJourney(record, 'departure');
        })().catch(() => console.warn('Departure capture failed'));
    });
}
export async function recoverJourneys(): Promise<void> {
    await db.memberJourney.deleteMany({
        where: { expiresAt: { lte: new Date() } },
    });
    const pending = await db.memberJourney.findMany({
        where: {
            expiresAt: { gt: new Date() },
            OR: [
                { state: 'PENDING' },
                { leftAt: { not: null }, departureState: 'PENDING' },
                { acknowledgedAt: { not: null }, rolesState: 'WAITING' },
            ],
        },
        take: 100,
        orderBy: { createdAt: 'asc' },
    });
    for (const record of pending) {
        if (!(await moduleRegistry.enabled(record.guildId, 'onboarding'))) {
            await db.memberJourney.updateMany({
                where: { id: record.id, state: 'PENDING' },
                data: { state: 'SKIPPED' },
            });
            await db.memberJourney.updateMany({
                where: { id: record.id, departureState: 'PENDING' },
                data: { departureState: 'SKIPPED' },
            });
            continue;
        }
        if (record.state === 'PENDING' && !record.leftAt)
            await queueJourney(record, 'join');
        if (record.leftAt && record.departureState === 'PENDING')
            await queueJourney(record, 'departure');
        if (record.acknowledgedAt && record.rolesState === 'WAITING')
            await queueJourney(record, 'roles');
    }
}
