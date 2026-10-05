import { createHash } from 'node:crypto';

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
import { env } from '../utils/env';

import { workflowRule, workflowsConfig } from './config';

const eventInput = z
    .object({
        guildId: z.string().regex(/^\d{17,20}$/),
        eventId: z.string().min(1).max(150),
        trigger: z.enum(['member_join', 'provider_event', 'manual']),
        at: z.date(),
        memberId: z
            .string()
            .regex(/^\d{17,20}$/)
            .nullable()
            .default(null),
        roleIds: z.array(z.string()).max(100).default([]),
        provider: z.enum(['twitch', 'youtube', 'rss']).optional(),
        title: z.string().max(200).default(''),
        url: z.string().url().max(1000).optional(),
        ruleId: z.string().optional(),
    })
    .strict();
export type WorkflowEvent = z.input<typeof eventInput>;
const fingerprint = (rule: z.infer<typeof workflowRule>) =>
    createHash('sha256').update(JSON.stringify(rule)).digest('hex');
const clean = (value: string) =>
    value.replace(/@/g, '＠').replace(/[\\*_~`>|]/g, '');
export async function reserveWorkflowRuns(
    tx: Prisma.TransactionClient,
    input: WorkflowEvent
) {
    const event = eventInput.parse(input);
    if (
        Math.abs(Date.now() - event.at.getTime()) > 300000 ||
        (env.BOT_GUILD_IDS.length && !env.BOT_GUILD_IDS.includes(event.guildId))
    )
        return [];
    await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${event.guildId})::bigint)::text`
    );
    const installation = await tx.guildInstallation.findUnique({
            where: { guildId: event.guildId },
        }),
        settings = await tx.guildModuleConfig.findUnique({
            where: {
                guildId_moduleId: {
                    guildId: event.guildId,
                    moduleId: 'workflows',
                },
            },
        });
    if (!installation?.active || !settings?.enabled || settings.version !== 1)
        return [];
    const rules = workflowsConfig.parse(settings.config).rules;
    const runs = [];
    for (const rule of rules) {
        if (
            rule.trigger !== event.trigger ||
            (event.ruleId && rule.id !== event.ruleId) ||
            (rule.provider !== 'any' && rule.provider !== event.provider) ||
            (rule.contains &&
                !event.title
                    .toLowerCase()
                    .includes(rule.contains.toLowerCase())) ||
            (rule.requiredRole &&
                (!event.memberId || !event.roleIds.includes(rule.requiredRole)))
        )
            continue;
        const prior = await tx.workflowRun.findUnique({
            where: {
                guildId_ruleId_eventId: {
                    guildId: event.guildId,
                    ruleId: rule.id,
                    eventId: event.eventId,
                },
            },
        });
        if (prior) {
            runs.push(prior);
            continue;
        }
        if (
            (await tx.workflowRun.count({
                where: { guildId: event.guildId },
            })) >= 1000 ||
            (await tx.durableJob.count({
                where: {
                    guildId: event.guildId,
                    state: { in: ['PENDING', 'LEASED', 'RECONCILE'] },
                },
            })) >= 1000
        )
            break;
        const last = await tx.workflowRun.findFirst({
            where: {
                guildId: event.guildId,
                ruleId: rule.id,
                state: { not: 'SKIPPED' },
            },
            orderBy: { createdAt: 'desc' },
        });
        const daily = await tx.workflowRun.count({
            where: {
                guildId: event.guildId,
                ruleId: rule.id,
                state: { not: 'SKIPPED' },
                createdAt: { gte: new Date(Date.now() - 86400000) },
            },
        });
        const skipped =
            (!!last &&
                last.createdAt.getTime() + rule.cooldownSeconds * 1000 >
                    Date.now()) ||
            daily >= 50;
        const content = skipped
            ? ''
            : rule.message
                  .replace(/\{(member|title|url)\}/g, (_match, key: string) =>
                      clean(
                          key === 'member'
                              ? (event.memberId ?? 'member')
                              : key === 'title'
                                ? event.title
                                : (event.url ?? '')
                      )
                  )
                  .slice(0, 1800);
        const run = await tx.workflowRun.create({
            data: {
                guildId: event.guildId,
                ruleId: rule.id,
                eventId: event.eventId,
                actorId: rule.actorId,
                fingerprint: fingerprint(rule),
                channelId: rule.channelId,
                memberId: event.memberId,
                content,
                state: skipped ? 'SKIPPED' : 'PENDING',
            },
        });
        runs.push(run);
        if (!skipped)
            await tx.durableJob.create({
                data: {
                    guildId: event.guildId,
                    actorId: rule.actorId,
                    moduleId: 'workflows',
                    kind: 'workflow-message',
                    idempotencyKey: 'workflow-run:' + run.id,
                    payload: { runId: run.id },
                    runAt: new Date(),
                    expiresAt: new Date(Date.now() + 300000),
                },
            });
    }
    return runs;
}
export async function triggerWorkflow(input: WorkflowEvent) {
    return db.$transaction((tx) => reserveWorkflowRuns(tx, input));
}
async function destination(
    client: Client,
    guildId: string,
    actorId: string,
    channelId: string,
    memberId: string | null,
    requiredRole: string | null
) {
    if (!(await moduleRegistry.enabled(guildId, 'workflows')))
        throw new Error('Workflows disabled');
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
        throw new Error('Current manager and channel permissions required');
    if (memberId) {
        const member = await guild.members.fetch({
            user: memberId,
            force: true,
        });
        if (
            member.user.bot ||
            !channel
                .permissionsFor(member)
                ?.has(PermissionFlagsBits.ViewChannel) ||
            (requiredRole && !member.roles.cache.has(requiredRole))
        )
            throw new Error('Trigger member no longer eligible');
    }
    if (
        channel.type !== ChannelType.GuildText &&
        channel.type !== ChannelType.GuildAnnouncement
    )
        throw new Error('Text channel required');
    return channel;
}
export function workflowMessageHandler(client: Client): JobHandler {
    async function context(job: DurableJob) {
        const { runId } = z
            .object({ runId: z.string().uuid() })
            .strict()
            .parse(job.payload);
        const run = await db.workflowRun.findFirst({
            where: { id: runId, guildId: job.guildId, actorId: job.actorId },
        });
        const settings = await db.guildModuleConfig.findUnique({
            where: {
                guildId_moduleId: {
                    guildId: job.guildId,
                    moduleId: 'workflows',
                },
            },
        });
        const rule = settings?.enabled
            ? workflowsConfig
                  .parse(settings.config)
                  .rules.find((row) => row.id === run?.ruleId)
            : undefined;
        return { run, rule };
    }
    return {
        authorize: async (job) => {
            const { run, rule } = await context(job);
            if (
                !run ||
                !rule ||
                run.state === 'CANCELLED' ||
                fingerprint(rule) !== run.fingerprint
            )
                return false;
            await destination(
                client,
                job.guildId,
                run.actorId,
                run.channelId,
                run.memberId,
                rule.requiredRole
            );
            return true;
        },
        execute: async (job) => {
            const { run, rule } = await context(job);
            if (!run || !rule || fingerprint(rule) !== run.fingerprint)
                return {
                    state: 'CANCELLED',
                    reason: 'Workflow changed or unavailable',
                };
            const channel = await destination(
                client,
                job.guildId,
                run.actorId,
                run.channelId,
                run.memberId,
                rule.requiredRole
            );
            return db.$transaction(
                async (tx) => {
                    await tx.$queryRaw(
                        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${job.guildId})::bigint)::text`
                    );
                    const installation = await tx.guildInstallation.findUnique({
                        where: { guildId: job.guildId },
                    });
                    if (!installation?.active)
                        return {
                            state: 'CANCELLED',
                            reason: 'Installation unavailable',
                        };
                    const settings = await tx.guildModuleConfig.findUnique({
                            where: {
                                guildId_moduleId: {
                                    guildId: job.guildId,
                                    moduleId: 'workflows',
                                },
                            },
                        }),
                        freshRule = settings?.enabled
                            ? workflowsConfig
                                  .parse(settings.config)
                                  .rules.find((row) => row.id === run.ruleId)
                            : undefined,
                        fresh = await tx.workflowRun.findUniqueOrThrow({
                            where: { id: run.id },
                        });
                    if (
                        !freshRule ||
                        fingerprint(freshRule) !== fresh.fingerprint ||
                        fresh.state === 'CANCELLED' ||
                        job.expiresAt <= new Date()
                    )
                        return {
                            state: 'CANCELLED',
                            reason: 'Workflow changed, cancelled or expired',
                        };
                    if (fresh.state === 'DELIVERED' && fresh.messageId)
                        return {
                            state: 'DELIVERED',
                            result: { messageId: fresh.messageId },
                        };
                    if (fresh.state !== 'PENDING')
                        return {
                            state: 'RECONCILE',
                            reason: 'Prior send requires inspection',
                        };
                    try {
                        const message = await channel.send({
                            content: fresh.content,
                            allowedMentions: {
                                parse: [],
                                users: [],
                                repliedUser: false,
                            },
                        });
                        await tx.workflowRun.update({
                            where: { id: run.id },
                            data: { state: 'DELIVERED', messageId: message.id },
                        });
                        return {
                            state: 'DELIVERED',
                            result: { messageId: message.id },
                        };
                    } catch {
                        await tx.workflowRun.update({
                            where: { id: run.id },
                            data: { state: 'UNCERTAIN' },
                        });
                        return {
                            state: 'RECONCILE',
                            reason: 'Workflow send uncertain; inspect destination',
                        };
                    }
                },
                { timeout: 60000 }
            );
        },
        reconcile: async (job) => {
            const { run, rule } = await context(job);
            if (!run?.messageId || !rule)
                return { state: 'RECONCILE', reason: 'Receipt unavailable' };
            const channel = await destination(
                client,
                job.guildId,
                run.actorId,
                run.channelId,
                run.memberId,
                rule.requiredRole
            );
            const message = await channel.messages.fetch({
                message: run.messageId,
                force: true,
            });
            return message.author.id === client.user?.id
                ? { state: 'DELIVERED', result: { messageId: message.id } }
                : { state: 'RECONCILE', reason: 'Message authorship mismatch' };
        },
    };
}
export function registerWorkflowEvents(client: Client) {
    client.on('guildMemberAdd', (member) => {
        if (member.user.bot) return;
        void moduleRegistry.dispatch(member.guild.id, 'workflows', () =>
            triggerWorkflow({
                guildId: member.guild.id,
                eventId: 'join:' + member.id + ':' + member.joinedTimestamp,
                trigger: 'member_join',
                at: member.joinedAt ?? new Date(),
                memberId: member.id,
                roleIds: [...member.roles.cache.keys()],
            })
        );
    });
}
export async function expireWorkflowRuns() {
    const cancelled = await db.$queryRaw<{ id: string; guildId: string }[]>(
        Prisma.sql`SELECT r.id,r."guildId" FROM "WorkflowRun" r JOIN "DurableJob" j ON j."guildId"=r."guildId" AND j.payload->>'runId'=r.id WHERE r.state='PENDING' AND j.kind='workflow-message' AND j.state IN ('CANCELLED','FAILED') ORDER BY r."createdAt" ASC LIMIT 100`
    );
    for (const run of cancelled)
        await db.$transaction(async (tx) => {
            await tx.$queryRaw(
                Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${run.guildId})::bigint)::text`
            );
            if (
                await tx.durableJob.count({
                    where: {
                        guildId: run.guildId,
                        idempotencyKey: 'workflow-run:' + run.id,
                        state: { in: ['CANCELLED', 'FAILED'] },
                    },
                })
            )
                await tx.workflowRun.updateMany({
                    where: {
                        id: run.id,
                        guildId: run.guildId,
                        state: 'PENDING',
                    },
                    data: { state: 'CANCELLED', content: '' },
                });
        });
    const runs = await db.workflowRun.findMany({
        where: {
            createdAt: { lt: new Date(Date.now() - 30 * 86400000) },
            state: { in: ['DELIVERED', 'SKIPPED', 'CANCELLED'] },
        },
        take: 100,
    });
    for (const run of runs)
        await db.$transaction(async (tx) => {
            await tx.$queryRaw(
                Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${run.guildId})::bigint)::text`
            );
            const key = 'workflow-run:' + run.id;
            if (
                await tx.durableJob.count({
                    where: {
                        guildId: run.guildId,
                        idempotencyKey: key,
                        state: { in: ['LEASED', 'RECONCILE'] },
                    },
                })
            )
                return;
            await tx.jobAttempt.deleteMany({
                where: { job: { guildId: run.guildId, idempotencyKey: key } },
            });
            await tx.durableJob.deleteMany({
                where: { guildId: run.guildId, idempotencyKey: key },
            });
            await tx.workflowRun.deleteMany({ where: { id: run.id } });
        });
}
export const workflowCommand = new SlashCommandBuilder()
    .setName('workflow')
    .setDescription('Test or cancel a configured workflow')
    .addSubcommand((s) =>
        s
            .setName('run')
            .setDescription('Reserve a manual workflow action')
            .addStringOption((o) =>
                o
                    .setName('id')
                    .setDescription('Manual workflow ID')
                    .setRequired(true)
            )
    )
    .addSubcommand((s) =>
        s
            .setName('cancel')
            .setDescription('Cancel a pending run')
            .addStringOption((o) =>
                o.setName('id').setDescription('Run ID').setRequired(true)
            )
    );
export async function routeWorkflow(interaction: Interaction) {
    if (
        !interaction.isChatInputCommand() ||
        interaction.commandName !== 'workflow'
    )
        return false;
    await interaction.deferReply({ flags: 64 });
    if (!interaction.guildId) throw new Error('Server command required');
    await destination(
        interaction.client,
        interaction.guildId,
        interaction.user.id,
        interaction.channelId,
        null,
        null
    );
    if (interaction.options.getSubcommand() === 'run') {
        const runs = await triggerWorkflow({
            guildId: interaction.guildId,
            eventId: 'manual:' + interaction.id,
            trigger: 'manual',
            at: new Date(),
            ruleId: interaction.options.getString('id', true),
        });
        await interaction.editReply(
            runs.length
                ? runs
                      .map(
                          (run) =>
                              `${run.id}: ${run.state}${run.state === 'PENDING' ? ' (delivery pending)' : ''}`
                      )
                      .join('\n')
                : 'No eligible manual workflow matched.'
        );
    } else {
        const id = interaction.options.getString('id', true),
            guildId = interaction.guildId;
        await db.$transaction(async (tx) => {
            await tx.$queryRaw(
                Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
            );
            const cancelled = await tx.workflowRun.updateMany({
                where: { id, guildId, state: 'PENDING' },
                data: { state: 'CANCELLED', content: '' },
            });
            if (!cancelled.count) throw new Error('Pending run unavailable');
            await tx.durableJob.updateMany({
                where: {
                    guildId,
                    idempotencyKey: 'workflow-run:' + id,
                    state: 'PENDING',
                },
                data: { state: 'CANCELLED', lastError: 'Cancelled by manager' },
            });
        });
        await interaction.editReply('Pending workflow run cancelled.');
    }
    return true;
}
