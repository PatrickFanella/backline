import { createHash } from 'crypto';

import { Prisma } from '@prisma/client';
import { Client, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { z } from 'zod';

import { db } from '../db';
import { enqueueJob, JobHandler } from '../jobs/store';
import { performModeration } from '../moderation/service';
import { moduleRegistry } from '../modules/registry';

import { recordAudit } from './audit';
import { antiSpamConfig } from './config';

function policyHash(config: z.infer<typeof antiSpamConfig>) {
    return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}
export type SpamEvent = {
    guildId: string;
    eventId: string;
    userId: string;
    type: 'message' | 'join';
    occurredAt: Date;
    content?: string;
    mentions?: number;
    channelId?: string;
    roleIds: string[];
    exempt: boolean;
};
export function contentReasons(
    config: z.infer<typeof antiSpamConfig>,
    content: string,
    mentions: number
): string[] {
    const reasons = [];
    if (mentions >= config.mentionLimit) reasons.push('mention-flood');
    const normalized = content.normalize('NFKC').toLowerCase().slice(0, 4000);
    if (
        config.prohibitedWords.some((word) =>
            normalized.includes(word.normalize('NFKC').toLowerCase())
        )
    )
        reasons.push('prohibited-word');
    const urls = normalized.match(/https?:\/\/[^\s<>]+/g) ?? [];
    if (
        urls.slice(0, 50).some((value) => {
            try {
                const host = new URL(value).hostname;
                return config.prohibitedDomains.some(
                    (domain) => host === domain || host.endsWith('.' + domain)
                );
            } catch {
                return false;
            }
        })
    )
        reasons.push('prohibited-link');
    return reasons;
}
export async function antiSpamSettings(guildId: string) {
    if (!(await moduleRegistry.enabled(guildId, 'anti-spam'))) return null;
    const row = await db.guildModuleConfig.findUnique({
        where: { guildId_moduleId: { guildId, moduleId: 'anti-spam' } },
    });
    return row ? antiSpamConfig.parse(row.config) : null;
}
export async function inspectSpam(event: SpamEvent): Promise<void> {
    const config = await antiSpamSettings(event.guildId);
    if (
        !config ||
        event.exempt ||
        event.roleIds.some((role) => config.exemptRoles.includes(role)) ||
        (event.channelId && config.exemptChannels.includes(event.channelId))
    )
        return;
    if (
        event.occurredAt.getTime() < Date.now() - 300000 ||
        event.occurredAt.getTime() > Date.now() + 120000
    )
        return;
    const decision = await db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${event.guildId})::bigint)::text`
        );
        if (
            await tx.spamSample.findUnique({
                where: {
                    guildId_eventId: {
                        guildId: event.guildId,
                        eventId: event.eventId,
                    },
                },
            })
        )
            return null;
        if (
            (await tx.spamSample.count({
                where: {
                    guildId: event.guildId,
                    occurredAt: { gt: new Date(Date.now() - 600000) },
                },
            })) >= 10000
        )
            throw new Error('Spam sample capacity reached');
        await tx.spamSample.create({
            data: {
                guildId: event.guildId,
                eventId: event.eventId,
                userId: event.userId,
                type: event.type,
                occurredAt: event.occurredAt,
            },
        });
        const duration =
            event.type === 'join'
                ? config.joinWindowSeconds
                : config.windowSeconds;
        const count = await tx.spamSample.count({
            where: {
                guildId: event.guildId,
                type: event.type,
                ...(event.type === 'message' ? { userId: event.userId } : {}),
                occurredAt: {
                    gte: new Date(Date.now() - duration * 1000),
                    lte: new Date(Date.now() + 120000),
                },
            },
        });
        const reasons =
            event.type === 'message'
                ? contentReasons(
                      config,
                      event.content ?? '',
                      event.mentions ?? 0
                  )
                : [];
        if (
            count >=
            (event.type === 'join' ? config.joinLimit : config.messageLimit)
        )
            reasons.push(
                event.type === 'join' ? 'join-burst' : 'message-burst'
            );
        let raid = await tx.raidState.findUnique({
            where: { guildId: event.guildId },
        });
        if (event.type === 'join' && reasons.includes('join-burst'))
            raid = await tx.raidState.upsert({
                where: { guildId: event.guildId },
                create: {
                    guildId: event.guildId,
                    until: new Date(Date.now() + config.raidMinutes * 60000),
                },
                update: {
                    until: new Date(Date.now() + config.raidMinutes * 60000),
                },
            });
        if (
            event.type === 'join' &&
            raid &&
            raid.until > new Date() &&
            !reasons.includes('join-burst')
        )
            reasons.push('raid-mode');
        if (!reasons.length) return null;
        return tx.spamDecision.create({
            data: {
                guildId: event.guildId,
                eventId: event.eventId,
                userId: event.userId,
                reasons,
                policyHash: policyHash(config),
                channelId: event.channelId,
                mode: config.observeOnly ? 'OBSERVE' : 'TIMEOUT',
                state: config.observeOnly ? 'OBSERVED' : 'PENDING',
            },
        });
    });
    if (!decision) return;
    await recordAudit({
        guildId: event.guildId,
        eventKey: `spam:${decision.id}`,
        kind: 'moderation',
        subjectId: event.userId,
        channelId: event.channelId,
        data: {
            decisionId: decision.id,
            reasons: z.json().parse(decision.reasons),
            mode: decision.mode,
        },
    });
    if (!config.observeOnly)
        await queueDecision(
            decision.id,
            event.guildId,
            event.userId,
            config.timeoutMinutes
        );
}
async function queueDecision(
    decisionId: string,
    guildId: string,
    userId: string,
    minutes: number
) {
    const job = await enqueueJob({
        guildId,
        actorId: 'system:anti-spam',
        moduleId: 'anti-spam',
        kind: 'anti-spam',
        idempotencyKey: `anti-spam:${decisionId}`,
        payload: { decisionId, userId, minutes },
        runAt: new Date(),
        expiresAt: new Date(Date.now() + 300000),
        maxAttempts: 1,
    });
    await db.spamDecision.update({
        where: { id: decisionId },
        data: { jobId: job.id },
    });
}
export function antiSpamHandler(client: Client): JobHandler {
    return {
        authorize: async (job) => {
            const config = await antiSpamSettings(job.guildId);
            return (
                !!config &&
                !config.observeOnly &&
                (await moduleRegistry.enabled(job.guildId, 'moderation'))
            );
        },
        execute: async (job) => {
            const payload = z
                .object({
                    decisionId: z.string(),
                    userId: z.string(),
                    minutes: z.number().int().min(1).max(60),
                })
                .parse(job.payload);
            const decision = await db.spamDecision.findFirst({
                where: {
                    id: payload.decisionId,
                    guildId: job.guildId,
                    userId: payload.userId,
                    mode: 'TIMEOUT',
                },
            });
            if (!decision)
                return {
                    state: 'CANCELLED',
                    reason: 'Spam decision unavailable',
                };
            const config = await antiSpamSettings(job.guildId);
            if (
                !config ||
                config.observeOnly ||
                policyHash(config) !== decision.policyHash ||
                (decision.channelId &&
                    config.exemptChannels.includes(decision.channelId))
            )
                return {
                    state: 'CANCELLED',
                    reason: 'Observe-only policy enabled',
                };
            const guild = await client.guilds.fetch({
                guild: job.guildId,
                force: true,
            });
            const member = await guild.members.fetch({
                user: payload.userId,
                force: true,
            });
            if (
                member.user.bot ||
                member.id === guild.ownerId ||
                member.permissions.has(PermissionFlagsBits.ManageGuild) ||
                member.permissions.has(PermissionFlagsBits.Administrator) ||
                member.roles.cache.some((role) =>
                    config.exemptRoles.includes(role.id)
                )
            )
                return {
                    state: 'CANCELLED',
                    reason: 'Current spam exemption applies',
                };
            const result = await performModeration(
                client,
                job.guildId,
                client.user!.id,
                job.id,
                {
                    action: 'timeout',
                    targetId: member.id,
                    reason: `Anti-spam decision ${decision.id}`,
                    minutes: Math.min(payload.minutes, config.timeoutMinutes),
                }
            );
            await db.spamDecision.update({
                where: { id: decision.id },
                data: { state: result.state },
            });
            return result.state === 'DELIVERED'
                ? {
                      state: 'DELIVERED',
                      result: { decisionId: decision.id, caseId: result.id },
                  }
                : {
                      state:
                          result.state === 'UNCERTAIN' ||
                          result.state === 'PENDING'
                              ? 'RECONCILE'
                              : 'FAILED',
                      reason: result.detail ?? 'Timeout not delivered',
                  };
        },
        reconcile: async (job) => {
            const record = await db.moderationCase.findUnique({
                where: {
                    guildId_requestId: {
                        guildId: job.guildId,
                        requestId: job.id,
                    },
                },
            });
            return record?.state === 'DELIVERED'
                ? { state: 'DELIVERED', result: { caseId: record.id } }
                : {
                      state: 'RECONCILE',
                      reason: 'Moderation outcome not proven',
                  };
        },
    };
}
export function registerAntiSpamEvents(client: Client): void {
    client.on('messageCreate', (message) => {
        if (!message.guild || message.author.bot) return;
        void (async () => {
            if (!client.options.intents.has(GatewayIntentBits.MessageContent))
                return;
            const member = await message.guild!.members.fetch({
                user: message.author.id,
                force: true,
            });
            await inspectSpam({
                guildId: message.guildId!,
                eventId: `message:${message.id}`,
                userId: message.author.id,
                type: 'message',
                occurredAt: message.createdAt,
                content: message.content,
                mentions:
                    message.mentions.users.size +
                    message.mentions.roles.size +
                    (message.mentions.everyone ? 1 : 0),
                channelId: message.channelId,
                roleIds: [...member.roles.cache.keys()],
                exempt:
                    member.id === message.guild!.ownerId ||
                    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
                    member.permissions.has(PermissionFlagsBits.Administrator),
            });
        })().catch(() => console.warn('Spam inspection failed'));
    });
    client.on('guildMemberAdd', (member) => {
        if (member.user.bot) return;
        void inspectSpam({
            guildId: member.guild.id,
            eventId: `join:${member.id}:${member.joinedTimestamp}`,
            userId: member.id,
            type: 'join',
            occurredAt: member.joinedAt ?? new Date(),
            roleIds: [...member.roles.cache.keys()],
            exempt:
                member.id === member.guild.ownerId ||
                member.permissions.has(PermissionFlagsBits.ManageGuild) ||
                member.permissions.has(PermissionFlagsBits.Administrator),
        }).catch(() => console.warn('Join burst inspection failed'));
    });
}
export async function recoverSpamDecisions(): Promise<void> {
    await db.spamSample.deleteMany({
        where: { occurredAt: { lt: new Date(Date.now() - 600000) } },
    });
    await db.spamDecision.deleteMany({
        where: {
            createdAt: { lt: new Date(Date.now() - 90 * 86400000) },
            state: { notIn: ['PENDING', 'UNCERTAIN'] },
        },
    });
    const decisions = await db.spamDecision.findMany({
        where: { state: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: 100,
    });
    for (const decision of decisions) {
        if (decision.jobId) {
            const job = await db.durableJob.findUnique({
                where: { id: decision.jobId },
            });
            if (job && ['CANCELLED', 'FAILED', 'DELIVERED'].includes(job.state))
                await db.spamDecision.update({
                    where: { id: decision.id },
                    data: { state: job.state },
                });
            continue;
        }
        const config = await antiSpamSettings(decision.guildId);
        if (
            !config ||
            config.observeOnly ||
            policyHash(config) !== decision.policyHash ||
            decision.createdAt.getTime() < Date.now() - 300000
        ) {
            await db.spamDecision.update({
                where: { id: decision.id },
                data: { state: 'CANCELLED' },
            });
            continue;
        }
        await queueDecision(
            decision.id,
            decision.guildId,
            decision.userId,
            config.timeoutMinutes
        );
    }
}
