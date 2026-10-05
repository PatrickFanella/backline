import { createHmac } from 'crypto';

import { DurableJob, Prisma } from '@prisma/client';
import {
    Client,
    Guild,
    GuildMember,
    Interaction,
    SlashCommandBuilder,
} from 'discord.js';
import { z } from 'zod';

import { db } from '../db';
import { ActionOutcome, JobHandler } from '../jobs/store';
import { moduleRegistry } from '../modules/registry';
import { env } from '../utils/env';

import { levelingConfig } from './config';
import { assertAssignableRole } from './roles';

export const levelForXp = (xp: number): number =>
    Math.floor(Math.sqrt(xp / 100));
const publicFields = {
    memberId: true,
    displayName: true,
    xp: true,
    updatedAt: true,
} as const;
export async function leaderboard(guildId: string) {
    const rows = await db.levelProfile.findMany({
        where: { guildId },
        select: publicFields,
        orderBy: [{ xp: 'desc' }, { memberId: 'asc' }],
        take: 25,
    });
    return rows.map((row) => ({ ...row, level: levelForXp(row.xp) }));
}
export async function profile(guildId: string, memberId: string) {
    const row = await db.levelProfile.findUnique({
        where: { guildId_memberId: { guildId, memberId } },
        select: publicFields,
    });
    return row
        ? {
              ...row,
              level: levelForXp(row.xp),
              nextLevelXp: 100 * (levelForXp(row.xp) + 1) ** 2,
          }
        : null;
}
async function settings(guildId: string) {
    if (!(await moduleRegistry.enabled(guildId, 'leveling'))) return null;
    const row = await db.guildModuleConfig.findUnique({
        where: { guildId_moduleId: { guildId, moduleId: 'leveling' } },
    });
    return row ? levelingConfig.parse(row.config) : null;
}
const activity = z
    .object({
        guildId: z.string().regex(/^\d{17,20}$/),
        memberId: z.string().regex(/^\d{17,20}$/),
        requestId: z.string().min(1).max(100),
        displayName: z.string().max(100),
        channelId: z.string(),
        roleIds: z.array(z.string()),
        bot: z.boolean(),
        webhook: z.boolean().default(false),
        source: z.enum(['MESSAGE', 'VOICE']),
        content: z.string().max(4000).default(''),
        at: z.date(),
    })
    .strict();
export async function grantXp(
    input: z.input<typeof activity>
): Promise<boolean> {
    const event = activity.parse(input);
    // Stale events cannot replay after the bounded grant ledger has expired.
    if (
        event.bot ||
        event.webhook ||
        Math.abs(Date.now() - event.at.getTime()) > 300000
    )
        return false;
    if (!(await settings(event.guildId))) return false;
    return db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${event.guildId})::bigint)::text`
        );
        const installation = await tx.guildInstallation.findUnique({
            where: { guildId: event.guildId },
        });
        const saved = await tx.guildModuleConfig.findUnique({
            where: {
                guildId_moduleId: {
                    guildId: event.guildId,
                    moduleId: 'leveling',
                },
            },
        });
        if (!installation?.active || !saved?.enabled || saved.version !== 1)
            return false;
        const config = levelingConfig.parse(saved.config);
        if (
            config.excludedChannels.includes(event.channelId) ||
            event.roleIds.some((role) => config.excludedRoles.includes(role))
        )
            return false;
        if (
            event.source === 'VOICE' &&
            (!config.voiceEnabled || !env.BOT_VOICE_INTENT)
        )
            return false;
        if (
            await tx.levelGrant.findUnique({
                where: {
                    guildId_requestId: {
                        guildId: event.guildId,
                        requestId: event.requestId,
                    },
                },
            })
        )
            return false;
        if (
            (await tx.levelGrant.count({
                where: { guildId: event.guildId },
            })) >= 100000
        )
            return false;
        const key = { guildId: event.guildId, memberId: event.memberId };
        let row = await tx.levelProfile.findUnique({
            where: { guildId_memberId: key },
        });
        const normalized = event.content
            .trim()
            .replace(/\s+/g, ' ')
            .toLowerCase();
        if (
            event.source === 'MESSAGE' &&
            normalized.length < config.minMessageLength
        )
            return false;
        if (!row) {
            if (
                (await tx.levelProfile.count({
                    where: { guildId: event.guildId },
                })) >= 10000
            )
                return false;
            row = await tx.levelProfile.create({
                data: { ...key, displayName: event.displayName },
            });
        }
        const last =
            event.source === 'MESSAGE' ? row.lastMessageAt : row.lastVoiceAt;
        const cooldown =
            event.source === 'MESSAGE' ? config.cooldownSeconds * 1000 : 60000;
        if (last && event.at.getTime() - last.getTime() < cooldown)
            return false;
        if (event.source === 'MESSAGE') {
            const digest = createHmac('sha256', row.digestKey)
                .update(normalized)
                .digest('hex');
            const previous = await tx.levelDigest.findUnique({
                where: { guildId_memberId_digest: { ...key, digest } },
            });
            if (previous && previous.expiresAt > event.at) return false;
            await tx.levelDigest.upsert({
                where: { guildId_memberId_digest: { ...key, digest } },
                create: {
                    ...key,
                    digest,
                    expiresAt: new Date(event.at.getTime() + 86400000),
                },
                update: { expiresAt: new Date(event.at.getTime() + 86400000) },
            });
        }
        const amount =
            event.source === 'MESSAGE' ? config.messageXp : config.voiceXp;
        if (row.xp > 2000000000 - amount) return false;
        const updated = await tx.levelProfile.update({
            where: { guildId_memberId: key },
            data: {
                xp: { increment: amount },
                displayName: event.displayName,
                updatedAt: event.at,
                ...(event.source === 'MESSAGE'
                    ? { lastMessageAt: event.at }
                    : { lastVoiceAt: event.at }),
            },
        });
        await tx.levelGrant.create({
            data: {
                ...key,
                requestId: event.requestId,
                source: event.source,
                amount,
                createdAt: event.at,
            },
        });
        for (const reward of config.rewards.filter(
            (reward) => reward.level <= levelForXp(updated.xp)
        )) {
            const idempotencyKey = `level-reward:${event.memberId}:${reward.roleId}:${reward.level}`;
            const existing = await tx.durableJob.findUnique({
                where: {
                    guildId_idempotencyKey: {
                        guildId: event.guildId,
                        idempotencyKey,
                    },
                },
            });
            if (existing) continue;
            if (
                (await tx.durableJob.count({
                    where: {
                        guildId: event.guildId,
                        state: { in: ['PENDING', 'LEASED', 'RECONCILE'] },
                    },
                })) >= 1000
            )
                throw new Error('Reward queue full');
            await tx.durableJob.create({
                data: {
                    guildId: event.guildId,
                    actorId: event.memberId,
                    moduleId: 'leveling',
                    kind: 'level-reward',
                    idempotencyKey,
                    payload: {
                        memberId: event.memberId,
                        roleId: reward.roleId,
                        level: reward.level,
                    },
                    runAt: event.at,
                    expiresAt: new Date(event.at.getTime() + 7 * 86400000),
                },
            });
        }
        return true;
    });
}
const rewardInput = z
    .object({
        memberId: z.string(),
        roleId: z.string(),
        level: z.number().int(),
    })
    .strict();
async function rewardContext(client: Client, job: DurableJob) {
    const config = await settings(job.guildId);
    const data = rewardInput.parse(job.payload);
    if (
        !config?.rewards.some(
            (reward) =>
                reward.roleId === data.roleId && reward.level === data.level
        )
    )
        return null;
    const row = await profile(job.guildId, data.memberId);
    if (!row || row.level < data.level) return null;
    const guild = await client.guilds.fetch({
        guild: job.guildId,
        force: true,
    });
    const member = await guild.members.fetch({
        user: data.memberId,
        force: true,
    });
    const bot = await guild.members.fetchMe({ force: true });
    const role = await guild.roles.fetch(data.roleId, { force: true });
    if (
        !role ||
        member.user.bot ||
        member.roles.cache.some((role) =>
            config.excludedRoles.includes(role.id)
        )
    )
        return null;
    assertAssignableRole(guild, bot, role);
    return { member, data };
}
export function levelingHandler(client: Client): JobHandler {
    return {
        authorize: async (job) =>
            job.expiresAt > new Date() && !!(await settings(job.guildId)),
        execute: async (job): Promise<ActionOutcome> => {
            const context = await rewardContext(client, job);
            if (!context)
                return {
                    state: 'CANCELLED',
                    reason: 'Reward no longer configured or eligible',
                };
            await context.member.roles.add(
                context.data.roleId,
                'Configured level reward'
            );
            return {
                state: 'DELIVERED',
                result: {
                    memberId: context.data.memberId,
                    roleId: context.data.roleId,
                },
            };
        },
        reconcile: async (job): Promise<ActionOutcome> => {
            const context = await rewardContext(client, job);
            if (!context)
                return {
                    state: 'CANCELLED',
                    reason: 'Reward no longer eligible',
                };
            return context.member.roles.cache.has(context.data.roleId)
                ? {
                      state: 'DELIVERED',
                      result: {
                          memberId: context.data.memberId,
                          roleId: context.data.roleId,
                      },
                  }
                : {
                      state: 'RETRY',
                      reason: 'Idempotent role assignment can be retried',
                  };
        },
    };
}
export interface VoiceCandidate {
    memberId: string;
    channelId: string;
    bot: boolean;
    afk: boolean;
    deafened: boolean;
    muted: boolean;
    humans: number;
    roleIds: string[];
    displayName: string;
}
export function voiceEligible(
    candidate: VoiceCandidate,
    config: z.output<typeof levelingConfig>
): boolean {
    return (
        config.voiceEnabled &&
        !candidate.bot &&
        !candidate.afk &&
        (!config.excludeDeafened || !candidate.deafened) &&
        (!config.excludeMuted || !candidate.muted) &&
        (!config.excludeSolo || candidate.humans >= 2) &&
        !config.excludedChannels.includes(candidate.channelId) &&
        !candidate.roleIds.some((role) => config.excludedRoles.includes(role))
    );
}
// Reset partial minutes on moves, ineligibility and process restart. Never award offline time.
export class VoiceClock {
    private started = new Map<string, { channelId: string; at: number }>();
    reset(guildId: string, memberId: string): void {
        this.started.delete(`${guildId}:${memberId}`);
    }
    sample(
        guildId: string,
        candidates: VoiceCandidate[],
        config: z.output<typeof levelingConfig>,
        at: number
    ): VoiceCandidate[] {
        const present = new Set<string>(),
            earned: VoiceCandidate[] = [];
        for (const candidate of candidates) {
            const key = `${guildId}:${candidate.memberId}`;
            present.add(key);
            if (!voiceEligible(candidate, config)) {
                this.started.delete(key);
                continue;
            }
            const previous = this.started.get(key);
            if (!previous || previous.channelId !== candidate.channelId) {
                this.started.set(key, { channelId: candidate.channelId, at });
                continue;
            }
            if (at - previous.at >= 60000) {
                earned.push(candidate);
                this.started.set(key, { channelId: candidate.channelId, at });
            }
        }
        for (const key of this.started.keys())
            if (key.startsWith(`${guildId}:`) && !present.has(key))
                this.started.delete(key);
        return earned;
    }
}
function voiceCandidates(guild: Guild): VoiceCandidate[] {
    return guild.voiceStates.cache
        .filter((state) => !!state.channel && !!state.member)
        .map((state) => {
            const member = state.member as GuildMember;
            return {
                memberId: member.id,
                channelId: state.channelId!,
                bot: member.user.bot,
                afk: state.channelId === guild.afkChannelId,
                deafened: !!state.deaf,
                muted: !!state.mute,
                humans: state.channel!.members.filter((m) => !m.user.bot).size,
                roleIds: [...member.roles.cache.keys()],
                displayName: member.displayName,
            };
        });
}
export function registerLevelingEvents(client: Client): () => Promise<void> {
    const clock = new VoiceClock();
    client.on('messageCreate', (message) => {
        if (!message.guildId || !message.member) return;
        void grantXp({
            guildId: message.guildId,
            memberId: message.author.id,
            requestId: `message:${message.id}`,
            displayName: message.member.displayName,
            channelId: message.channelId,
            roleIds: [...message.member.roles.cache.keys()],
            bot: message.author.bot,
            webhook: !!message.webhookId,
            source: 'MESSAGE',
            content: message.content,
            at: message.createdAt,
        }).catch(() => console.warn('Leveling message failed'));
    });
    client.on('voiceStateUpdate', (before, after) => {
        if (
            before.channelId !== after.channelId ||
            before.deaf !== after.deaf ||
            before.mute !== after.mute
        ) {
            clock.reset(after.guild.id, after.id);
            for (const state of after.guild.voiceStates.cache.values())
                if (
                    state.channelId &&
                    (state.channelId === before.channelId ||
                        state.channelId === after.channelId)
                )
                    clock.reset(after.guild.id, state.id);
        }
    });
    let active: Promise<void> | undefined;
    const interval = setInterval(() => {
        if (active || !client.isReady() || !env.BOT_VOICE_INTENT) return;
        active = (async () => {
            for (const guild of client.guilds.cache.values()) {
                const config = await settings(guild.id);
                const candidates = voiceCandidates(guild);
                const earned = clock.sample(
                    guild.id,
                    candidates,
                    config ?? levelingConfig.parse({}),
                    Date.now()
                );
                for (const candidate of earned)
                    await grantXp({
                        guildId: guild.id,
                        memberId: candidate.memberId,
                        channelId: candidate.channelId,
                        bot: candidate.bot,
                        displayName: candidate.displayName,
                        requestId: `voice:${candidate.memberId}:${Math.floor(Date.now() / 60000)}`,
                        source: 'VOICE',
                        at: new Date(),
                        webhook: false,
                        content: '',
                        ...{ roleIds: candidate.roleIds },
                    });
            }
        })()
            .catch(() => console.warn('Leveling voice sampling failed'))
            .finally(() => {
                active = undefined;
            });
    }, 30000);
    interval.unref();
    return async () => {
        clearInterval(interval);
        await active;
    };
}
export async function expireLeveling(): Promise<void> {
    await db.levelDigest.deleteMany({
        where: { expiresAt: { lte: new Date() } },
    });
    const configs = await db.guildModuleConfig.findMany({
        where: { moduleId: 'leveling' },
    });
    for (const saved of configs) {
        const cutoff = new Date(
            Date.now() -
                levelingConfig.parse(saved.config).retentionDays * 86400000
        );
        await db.$transaction(async (tx) => {
            await tx.$queryRaw(
                Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${saved.guildId})::bigint)::text`
            );
            const expired = await tx.levelProfile.findMany({
                where: { guildId: saved.guildId, updatedAt: { lt: cutoff } },
                select: { memberId: true },
                take: 100,
            });
            const memberIds = expired.map((row) => row.memberId);
            await tx.levelDigest.deleteMany({
                where: { guildId: saved.guildId, memberId: { in: memberIds } },
            });
            await tx.levelGrant.deleteMany({
                where: { guildId: saved.guildId, memberId: { in: memberIds } },
            });
            await tx.levelProfile.deleteMany({
                where: { guildId: saved.guildId, memberId: { in: memberIds } },
            });
            await tx.levelGrant.deleteMany({
                where: { guildId: saved.guildId, createdAt: { lt: cutoff } },
            });
        });
    }
}
export const xpCommand = new SlashCommandBuilder()
    .setName('xp')
    .setDescription('Show server XP and levels')
    .setContexts(0)
    .setIntegrationTypes(0)
    .addSubcommand((command) =>
        command.setName('profile').setDescription('Show your XP')
    )
    .addSubcommand((command) =>
        command
            .setName('leaderboard')
            .setDescription('Show the top server members')
    )
    .toJSON();
export async function routeLeveling(
    interaction: Interaction
): Promise<boolean> {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'xp')
        return false;
    if (!interaction.guildId || !(await settings(interaction.guildId))) {
        await interaction.editReply('Leveling is disabled for this server.');
        return true;
    }
    if (interaction.options.getSubcommand() === 'leaderboard') {
        const rows = await leaderboard(interaction.guildId);
        await interaction.editReply({
            content: rows.length
                ? rows
                      .map(
                          (row, index) =>
                              `${index + 1}. <@${row.memberId}> — level ${row.level}, ${row.xp} XP`
                      )
                      .join('\n')
                : 'No XP earned yet.',
            allowedMentions: { parse: [] },
        });
    } else {
        const row = await profile(interaction.guildId, interaction.user.id);
        await interaction.editReply(
            row
                ? `Level ${row.level}: ${row.xp} XP. Next level at ${row.nextLevelXp} XP.`
                : 'You have not earned XP in this server yet.'
        );
    }
    return true;
}
