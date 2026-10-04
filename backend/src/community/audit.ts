import { randomUUID } from 'crypto';

import { Prisma } from '@prisma/client';
import { Client, DiscordAPIError, GatewayIntentBits } from 'discord.js';
import { z } from 'zod';

import { db } from '../db';
import { enqueueJob, JobHandler } from '../jobs/store';
import { moduleRegistry } from '../modules/registry';
import { toInputJson } from '../utils/prismaJson';

import { auditConfig, auditKinds } from './config';

const eventInput = z.object({
    guildId: z.string(),
    eventKey: z.string().max(200),
    kind: z.enum(auditKinds),
    subjectId: z.string().optional(),
    channelId: z.string().optional(),
    data: z.record(z.string(), z.json()).default({}),
});
export async function auditSettings(guildId: string) {
    if (!(await moduleRegistry.enabled(guildId, 'audit-log'))) return null;
    const settings = await db.guildModuleConfig.findUnique({
        where: { guildId_moduleId: { guildId, moduleId: 'audit-log' } },
    });
    return settings ? auditConfig.parse(settings.config) : null;
}
export async function recordAudit(
    raw: z.input<typeof eventInput>
): Promise<void> {
    const event = eventInput.parse(raw);
    const config = await auditSettings(event.guildId);
    if (!config || !config.channelId || !config.events.includes(event.kind))
        return;
    const data = { ...event.data };
    if (!config.retainContent) {
        delete data.content;
        delete data.before;
        delete data.after;
    }
    // Bound retained text and distinguish uncached content from an empty message.
    for (const key of ['content', 'before', 'after'])
        if (typeof data[key] === 'string') data[key] = data[key].slice(0, 1500);
    const record = await db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${event.guildId})::bigint)::text`
        );
        const existing = await tx.serverAuditEvent.findUnique({
            where: {
                guildId_eventKey: {
                    guildId: event.guildId,
                    eventKey: event.eventKey,
                },
            },
        });
        if (existing) return existing;
        return tx.serverAuditEvent.create({
            data: {
                ...event,
                data: toInputJson(data),
                expiresAt: new Date(
                    Date.now() + config.retentionDays * 86400000
                ),
            },
        });
    });
    if (record.state !== 'PENDING') return;
    await enqueueJob({
        guildId: event.guildId,
        actorId: 'system:audit',
        moduleId: 'audit-log',
        kind: 'audit-log',
        idempotencyKey: `audit:${record.id}`,
        payload: { eventId: record.id },
        runAt: new Date(),
        expiresAt: new Date(
            Math.min(record.expiresAt.getTime(), Date.now() + 86400000)
        ),
        maxAttempts: 1,
    });
}
export function auditHandler(client: Client): JobHandler {
    return {
        authorize: (job) => moduleRegistry.enabled(job.guildId, 'audit-log'),
        execute: async (job) => {
            const payload = z
                .object({ eventId: z.string() })
                .parse(job.payload);
            const record = await db.serverAuditEvent.findFirst({
                where: {
                    id: payload.eventId,
                    guildId: job.guildId,
                    expiresAt: { gt: new Date() },
                },
            });
            if (!record)
                return { state: 'CANCELLED', reason: 'Audit event expired' };
            if (record.state === 'DELIVERED')
                return {
                    state: 'DELIVERED',
                    result: { eventId: record.id, messageId: record.messageId },
                };
            if (record.state !== 'PENDING')
                return {
                    state: 'RECONCILE',
                    reason: 'Audit delivery requires investigation',
                };
            const config = await auditSettings(job.guildId);
            if (
                !config?.channelId ||
                !config.events.includes(
                    record.kind as (typeof auditKinds)[number]
                )
            )
                return {
                    state: 'CANCELLED',
                    reason: 'Audit destination or event disabled',
                };
            const guild = await client.guilds.fetch({
                guild: job.guildId,
                force: true,
            });
            const channel = await guild.channels.fetch(config.channelId);
            if (!channel || !channel.isTextBased() || !('send' in channel))
                return { state: 'FAILED', reason: 'Audit channel unavailable' };
            // Remove content even from queued events when an administrator turns retention off.
            const data = { ...(record.data as Record<string, unknown>) };
            if (!config.retainContent) {
                delete data.content;
                delete data.before;
                delete data.after;
            }
            const changed = await db.serverAuditEvent.updateMany({
                where: {
                    id: record.id,
                    guildId: job.guildId,
                    state: 'PENDING',
                },
                data: { state: 'SENDING' },
            });
            if (!changed.count)
                return {
                    state: 'RECONCILE',
                    reason: 'Audit event already claimed',
                };
            try {
                const message = await channel.send({
                    content: `Backline ${record.kind}\nSubject: ${record.subjectId ?? 'unavailable'}\nChannel: ${record.channelId ?? 'unavailable'}\n${JSON.stringify(data).slice(0, 1500)}\nEvent: ${record.id}`,
                    allowedMentions: { parse: [] },
                    nonce: record.id.replace(/-/g, '').slice(0, 24),
                    enforceNonce: true,
                });
                await db.serverAuditEvent.update({
                    where: { id: record.id },
                    data: { state: 'DELIVERED', messageId: message.id },
                });
                return {
                    state: 'DELIVERED',
                    result: { eventId: record.id, messageId: message.id },
                };
            } catch (error) {
                const rejected =
                    error instanceof DiscordAPIError &&
                    error.status >= 400 &&
                    error.status < 500;
                await db.serverAuditEvent.update({
                    where: { id: record.id },
                    data: {
                        state: rejected ? 'FAILED' : 'UNCERTAIN',
                        detail: rejected
                            ? 'Discord rejected audit delivery'
                            : 'Audit delivery uncertain',
                    },
                });
                return {
                    state: rejected ? 'FAILED' : 'RECONCILE',
                    reason: rejected
                        ? 'Discord rejected audit delivery'
                        : 'Audit delivery uncertain',
                };
            }
        },
        reconcile: async (job) => {
            const { eventId } = z
                .object({ eventId: z.string() })
                .parse(job.payload);
            const record = await db.serverAuditEvent.findFirst({
                where: {
                    id: eventId,
                    guildId: job.guildId,
                    state: 'DELIVERED',
                },
            });
            return record
                ? {
                      state: 'DELIVERED',
                      result: {
                          eventId: record.id,
                          messageId: record.messageId,
                      },
                  }
                : { state: 'RECONCILE', reason: 'Delivery not proven' };
        },
    };
}
export async function expireAuditContent(): Promise<void> {
    await db.serverAuditEvent.deleteMany({
        where: { expiresAt: { lte: new Date() } },
    });
}
export function registerAuditEvents(client: Client): void {
    const record = (input: z.input<typeof eventInput>) => {
        void recordAudit(input).catch(() =>
            console.warn('Audit capture failed')
        );
    };
    client.on('guildMemberAdd', (member) =>
        record({
            guildId: member.guild.id,
            eventKey: `join:${member.id}:${member.joinedTimestamp}`,
            kind: 'member-join',
            subjectId: member.id,
        })
    );
    client.on('guildMemberRemove', (member) =>
        record({
            guildId: member.guild.id,
            eventKey: `leave:${member.id}:${member.joinedTimestamp ?? randomUUID()}`,
            kind: 'member-leave',
            subjectId: member.id,
            data: { joinedAtAvailable: member.joinedTimestamp !== null },
        })
    );
    client.on('messageDelete', (message) => {
        if (message.guildId)
            record({
                guildId: message.guildId,
                eventKey: `delete:${message.id}`,
                kind: 'message-delete',
                subjectId: message.author?.id,
                channelId: message.channelId,
                data: {
                    content:
                        message.partial ||
                        !client.options.intents.has(
                            GatewayIntentBits.MessageContent
                        )
                            ? null
                            : message.content,
                    cached: !message.partial,
                    contentAvailable:
                        !message.partial &&
                        client.options.intents.has(
                            GatewayIntentBits.MessageContent
                        ),
                },
            });
    });
    client.on('messageUpdate', (before, after) => {
        if (after.guildId)
            record({
                guildId: after.guildId,
                eventKey: `edit:${after.id}:${after.editedTimestamp ?? randomUUID()}`,
                kind: 'message-edit',
                subjectId: after.author?.id,
                channelId: after.channelId,
                data: {
                    before:
                        before.partial ||
                        !client.options.intents.has(
                            GatewayIntentBits.MessageContent
                        )
                            ? null
                            : before.content,
                    after:
                        after.partial ||
                        !client.options.intents.has(
                            GatewayIntentBits.MessageContent
                        )
                            ? null
                            : after.content,
                    beforeCached: !before.partial,
                    afterCached: !after.partial,
                },
            });
    });
    client.on('guildMemberUpdate', (before, after) => {
        const added = after.roles.cache
            .filter((role) => !before.roles.cache.has(role.id))
            .map((role) => role.id);
        const removed = before.roles.cache
            .filter((role) => !after.roles.cache.has(role.id))
            .map((role) => role.id);
        if (added.length || removed.length)
            record({
                guildId: after.guild.id,
                eventKey: `roles:${after.id}:${randomUUID()}`,
                kind: 'member-roles',
                subjectId: after.id,
                data: { added, removed },
            });
    });
    client.on('roleCreate', (role) =>
        record({
            guildId: role.guild.id,
            eventKey: `role-create:${role.id}`,
            kind: 'role-create',
            subjectId: role.id,
        })
    );
    client.on('roleDelete', (role) =>
        record({
            guildId: role.guild.id,
            eventKey: `role-delete:${role.id}`,
            kind: 'role-delete',
            subjectId: role.id,
        })
    );
}

// Recover capture-to-queue interruptions without repeating an existing delivery.
export async function recoverAuditEvents(): Promise<void> {
    const pending = await db.serverAuditEvent.findMany({
        where: { state: 'PENDING', expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'asc' },
        take: 100,
    });
    for (const record of pending) {
        if (!(await moduleRegistry.enabled(record.guildId, 'audit-log'))) {
            await db.serverAuditEvent.updateMany({
                where: { id: record.id, state: 'PENDING' },
                data: { state: 'SKIPPED', detail: 'Module disabled' },
            });
            continue;
        }
        const job = await enqueueJob({
            guildId: record.guildId,
            actorId: 'system:audit',
            moduleId: 'audit-log',
            kind: 'audit-log',
            idempotencyKey: `audit:${record.id}`,
            payload: { eventId: record.id },
            runAt: new Date(),
            expiresAt: new Date(
                Math.min(record.expiresAt.getTime(), Date.now() + 86400000)
            ),
            maxAttempts: 1,
        });
        if (job.state === 'CANCELLED' || job.state === 'FAILED')
            await db.serverAuditEvent.updateMany({
                where: { id: record.id, state: 'PENDING' },
                data: {
                    state: 'SKIPPED',
                    detail: 'Delivery cancelled or failed',
                },
            });
    }
}
