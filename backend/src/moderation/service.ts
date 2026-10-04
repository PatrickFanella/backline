import { Prisma } from '@prisma/client';
import {
    Client,
    DiscordAPIError,
    Guild,
    GuildMember,
    PermissionFlagsBits,
} from 'discord.js';
import { z } from 'zod';

import { recordAudit } from '../community/audit';
import { db } from '../db';
import { moduleRegistry } from '../modules/registry';

const snowflake = z.string().regex(/^\d{17,20}$/);
export const moderationInput = z
    .object({
        action: z.enum(['warn', 'timeout', 'kick', 'ban', 'unban', 'purge']),
        targetId: snowflake.optional(),
        channelId: snowflake.optional(),
        reason: z.string().trim().min(1).max(400),
        minutes: z.number().int().min(1).max(40320).optional(),
        count: z.number().int().min(1).max(100).optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
        if (data.action !== 'purge' && !data.targetId)
            ctx.addIssue({ code: 'custom', message: 'Target required' });
        if (data.action === 'purge' && (!data.channelId || !data.count))
            ctx.addIssue({
                code: 'custom',
                message: 'Channel and count required',
            });
        if (data.action === 'timeout' && !data.minutes)
            ctx.addIssue({ code: 'custom', message: 'Duration required' });
    });
export type ModerationInput = z.infer<typeof moderationInput>;
export const actionPermissions = {
    warn: PermissionFlagsBits.ModerateMembers,
    timeout: PermissionFlagsBits.ModerateMembers,
    kick: PermissionFlagsBits.KickMembers,
    ban: PermissionFlagsBits.BanMembers,
    unban: PermissionFlagsBits.BanMembers,
    purge: PermissionFlagsBits.ManageMessages,
};
class Denied extends Error {}
export function assertHierarchy(
    guild: Pick<Guild, 'ownerId'>,
    actor: GuildMember,
    bot: GuildMember,
    target: GuildMember
): void {
    if (
        target.id === guild.ownerId ||
        target.id === actor.id ||
        target.id === bot.id
    )
        throw new Denied('Protected target');
    if (
        actor.id !== guild.ownerId &&
        actor.roles.highest.comparePositionTo(target.roles.highest) <= 0
    )
        throw new Denied('Target role is equal to or above your role');
    if (bot.roles.highest.comparePositionTo(target.roles.highest) <= 0)
        throw new Denied('Target role is equal to or above the bot role');
}

export async function performModeration(
    client: Client,
    guildId: string,
    actorId: string,
    requestId: string,
    raw: unknown
) {
    const input = moderationInput.parse(raw);
    const reserved = await db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
        );
        const existing = await tx.moderationCase.findUnique({
            where: { guildId_requestId: { guildId, requestId } },
        });
        if (existing) return { record: existing, fresh: false };
        const record = await tx.moderationCase.create({
            data: {
                guildId,
                requestId,
                actorId,
                action: input.action,
                targetId: input.targetId,
                channelId: input.channelId,
                reason: input.reason,
            },
        });
        return { record, fresh: true };
    });
    if (!reserved.fresh) return reserved.record;
    const id = reserved.record.id;
    let mutationStarted = false;
    try {
        if (!(await moduleRegistry.enabled(guildId, 'moderation')))
            throw new Denied('Moderation is disabled');
        const guild = await client.guilds.fetch({
            guild: guildId,
            force: true,
        });
        const actor = await guild.members.fetch({ user: actorId, force: true });
        const bot = await guild.members.fetchMe({ force: true });
        const permission = actionPermissions[input.action];
        if (!actor.permissions.has(permission))
            throw new Denied('Actor permission unavailable');
        if (!bot.permissions.has(permission))
            throw new Denied('Bot permission unavailable');
        const reason = `Backline case ${id}; actor ${actorId}; ${input.reason}`;
        let outcome: Prisma.InputJsonValue = {};
        if (input.action === 'purge') {
            const channel = await guild.channels.fetch(input.channelId!);
            if (
                !channel ||
                !channel.isTextBased() ||
                !('bulkDelete' in channel)
            )
                throw new Denied('Unsupported channel');
            const required = [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory,
                permission,
            ];
            if (
                !channel.permissionsFor(actor)?.has(required) ||
                !channel.permissionsFor(bot)?.has(required)
            )
                throw new Denied('Channel permission unavailable');
            const messages = await channel.messages.fetch({
                limit: input.count!,
            });
            const eligible = messages.filter(
                (message) =>
                    !message.pinned &&
                    message.createdTimestamp >
                        Date.now() - 14 * 86400000 + 60000
            );
            mutationStarted = true;
            const deleted = eligible.size
                ? await channel.bulkDelete(eligible, true)
                : new Map();
            outcome = {
                deletedIds: [...deleted.keys()],
                deletedCount: deleted.size,
                requested: input.count!,
                skipped: messages.size - deleted.size,
            };
        } else if (input.action === 'unban') {
            await guild.bans.fetch(input.targetId!);
            mutationStarted = true;
            await guild.members.unban(input.targetId!, reason);
            outcome = { unbanned: input.targetId! };
        } else {
            const target = await guild.members.fetch({
                user: input.targetId!,
                force: true,
            });
            assertHierarchy(guild, actor, bot, target);
            if (
                input.action === 'timeout' &&
                target.permissions.has(PermissionFlagsBits.Administrator)
            )
                throw new Denied('Administrators cannot be timed out');
            mutationStarted = true;
            switch (input.action) {
                case 'warn':
                    outcome = {
                        warningRecorded: true,
                        notificationSent: false,
                    };
                    break;
                case 'timeout': {
                    const member = await target.timeout(
                        input.minutes! * 60000,
                        reason
                    );
                    outcome = {
                        timeoutUntil:
                            member.communicationDisabledUntil?.toISOString() ??
                            null,
                    };
                    break;
                }
                case 'kick':
                    await target.kick(reason);
                    outcome = { kicked: target.id };
                    break;
                case 'ban':
                    await target.ban({ reason, deleteMessageSeconds: 0 });
                    outcome = { banned: target.id };
                    break;
            }
        }
        const delivered = await db.moderationCase.update({
            where: { id },
            data: { state: 'DELIVERED', outcome, completedAt: new Date() },
        });
        await recordAudit({
            guildId,
            eventKey: `moderation:${id}`,
            kind: 'moderation',
            subjectId: input.targetId,
            channelId: input.channelId,
            data: {
                caseId: id,
                actorId,
                action: input.action,
                reason: input.reason,
                outcome: z.json().parse(outcome),
            },
        }).catch(() => console.warn('Moderation audit capture failed'));
        return delivered;
    } catch (error) {
        const denied = error instanceof Denied;
        // A definite Discord 4xx rejection has no delivered action. Transport errors remain uncertain.
        const rejected =
            error instanceof DiscordAPIError &&
            error.status >= 400 &&
            error.status < 500;
        return db.moderationCase.update({
            where: { id },
            data: {
                state: denied
                    ? 'DENIED'
                    : mutationStarted && !rejected
                      ? 'UNCERTAIN'
                      : 'FAILED',
                detail: denied
                    ? error.message
                    : rejected
                      ? 'Discord rejected the action'
                      : mutationStarted
                        ? 'Outcome uncertain; do not repeat without investigation'
                        : 'Could not verify current Discord state',
                completedAt: new Date(),
            },
        });
    }
}
