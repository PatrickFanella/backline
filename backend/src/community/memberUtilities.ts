import { DurableJob, Prisma } from '@prisma/client';
import {
    ChannelType,
    Client,
    GuildMember,
    Interaction,
    Message,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';
import { z } from 'zod';

import { db } from '../db';
import { JobHandler } from '../jobs/store';
import { moduleRegistry } from '../modules/registry';

import { birthdaysConfig } from './memberUtilityConfig';

export async function utilityMember(
    client: Client,
    guildId: string,
    memberId: string,
    moduleId: string
): Promise<GuildMember> {
    if (!(await moduleRegistry.enabled(guildId, moduleId)))
        throw new Error('Member utility disabled');
    const guild = await client.guilds.fetch({ guild: guildId, force: true });
    const [member, account] = await Promise.all([
        guild.members.fetch({ user: memberId, force: true }),
        db.user.findUnique({
            where: { discordId: memberId },
            select: { role: true },
        }),
    ]);
    if (member.user.bot || account?.role === 'BANNED')
        throw new Error('Account unavailable');
    return member;
}
async function lock(tx: Prisma.TransactionClient, guildId: string) {
    await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
    );
}
async function current(
    tx: Prisma.TransactionClient,
    guildId: string,
    moduleId: string
) {
    const [installation, settings] = await Promise.all([
        tx.guildInstallation.findUnique({ where: { guildId } }),
        tx.guildModuleConfig.findUnique({
            where: { guildId_moduleId: { guildId, moduleId } },
        }),
    ]);
    if (!installation?.active || !settings?.enabled || settings.version !== 1)
        throw new Error('Member utility disabled');
    return settings.config;
}
export async function setAfk(
    client: Client,
    guildId: string,
    memberId: string,
    reason: unknown,
    hours: unknown = 24
) {
    const text = z.string().trim().min(1).max(160).parse(reason),
        ttl = z.number().int().min(1).max(24).parse(hours);
    await utilityMember(client, guildId, memberId, 'afk');
    return db.$transaction(async (tx) => {
        await lock(tx, guildId);
        await current(tx, guildId, 'afk');
        const where = { guildId_memberId: { guildId, memberId } };
        if (
            !(await tx.memberAfk.findUnique({ where })) &&
            (await tx.memberAfk.count({ where: { guildId } })) >= 1000
        )
            throw new Error('AFK capacity reached');
        const data = {
            reason: text,
            setAt: new Date(),
            expiresAt: new Date(Date.now() + ttl * 3600000),
            lastNoticeAt: null,
        };
        return tx.memberAfk.upsert({
            where,
            create: { guildId, memberId, ...data },
            update: data,
        });
    });
}
async function reserve(
    tx: Prisma.TransactionClient,
    guildId: string,
    actorId: string,
    moduleId: string,
    kind: string,
    key: string,
    payload: Prisma.InputJsonValue,
    expiresAt: Date
) {
    const existing = await tx.durableJob.findUnique({
        where: { guildId_idempotencyKey: { guildId, idempotencyKey: key } },
    });
    if (existing) return existing;
    if (
        (await tx.durableJob.count({
            where: { guildId, kind: { in: ['afk-notice', 'birthday-notice'] } },
        })) >= 1000 ||
        (await tx.durableJob.count({
            where: {
                guildId,
                state: { in: ['PENDING', 'LEASED', 'RECONCILE'] },
            },
        })) >= 1000
    )
        throw new Error('Member utility action capacity reached');
    return tx.durableJob.create({
        data: {
            guildId,
            actorId,
            moduleId,
            kind,
            idempotencyKey: key,
            payload,
            expiresAt,
            runAt: new Date(),
            maxAttempts: 1,
        },
    });
}
export async function observeAfkMessage(message: Message) {
    if (
        !message.guildId ||
        message.author.bot ||
        message.webhookId ||
        !(await moduleRegistry.enabled(message.guildId, 'afk'))
    )
        return;
    const guildId = message.guildId;
    await utilityMember(message.client, guildId, message.author.id, 'afk');
    await db.$transaction(async (tx) => {
        await lock(tx, guildId);
        await current(tx, guildId, 'afk');
        await tx.memberAfk.deleteMany({
            where: {
                guildId,
                memberId: message.author.id,
                setAt: { lte: message.createdAt },
            },
        });
        const ids = message.mentions.users
            .filter((user) => !user.bot && user.id !== message.author.id)
            .map((user) => user.id)
            .slice(0, 5);
        if (!ids.length) return;
        const absent = await tx.memberAfk.findMany({
            where: {
                guildId,
                memberId: { in: ids },
                expiresAt: { gt: new Date() },
                OR: [
                    { lastNoticeAt: null },
                    { lastNoticeAt: { lt: new Date(Date.now() - 30000) } },
                ],
            },
        });
        if (!absent.length) return;
        await reserve(
            tx,
            guildId,
            message.author.id,
            'afk',
            'afk-notice',
            'afk:' + message.id,
            {
                channelId: message.channelId,
                memberIds: absent.map((row) => row.memberId),
            },
            new Date(Date.now() + 60000)
        );
        await tx.memberAfk.updateMany({
            where: {
                guildId,
                memberId: { in: absent.map((row) => row.memberId) },
            },
            data: { lastNoticeAt: new Date() },
        });
    });
}
const birthdayInput = z
    .object({
        month: z.number().int().min(1).max(12),
        day: z.number().int().min(1).max(31),
        share: z.literal(true),
    })
    .strict()
    .refine(
        (value) =>
            new Date(
                Date.UTC(2000, value.month - 1, value.day)
            ).getUTCMonth() ===
            value.month - 1,
        'Invalid month and day'
    );
export async function setBirthday(
    client: Client,
    guildId: string,
    memberId: string,
    input: unknown
) {
    const parsed = birthdayInput.parse(input);
    const actor = await utilityMember(client, guildId, memberId, 'birthdays');
    return db.$transaction(async (tx) => {
        await lock(tx, guildId);
        const settings = birthdaysConfig.parse(
            await current(tx, guildId, 'birthdays')
        );
        if (!settings.channelId)
            throw new Error('Configure a birthday channel first');
        const channel = await actor.guild.channels.fetch(settings.channelId, {
            force: true,
        });
        if (
            !channel ||
            channel.type !== ChannelType.GuildText ||
            !channel.permissionsFor(actor)?.has(PermissionFlagsBits.ViewChannel)
        )
            throw new Error('Birthday channel unavailable');
        const where = { guildId_memberId: { guildId, memberId } };
        if (
            !(await tx.memberBirthday.findUnique({ where })) &&
            (await tx.memberBirthday.count({ where: { guildId } })) >= 1000
        )
            throw new Error('Birthday capacity reached');
        return tx.memberBirthday.upsert({
            where,
            create: { guildId, memberId, month: parsed.month, day: parsed.day },
            update: { month: parsed.month, day: parsed.day },
        });
    });
}
export async function removeBirthday(guildId: string, memberId: string) {
    await db.$transaction(async (tx) => {
        await lock(tx, guildId);
        await tx.memberBirthday.deleteMany({ where: { guildId, memberId } });
        await tx.durableJob.updateMany({
            where: {
                guildId,
                actorId: memberId,
                kind: 'birthday-notice',
                state: 'PENDING',
            },
            data: { state: 'CANCELLED', lastError: 'Birthday sharing removed' },
        });
    });
}
export function localCalendar(now: Date, timeZone: string) {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            hourCycle: 'h23',
        })
            .formatToParts(now)
            .map((part) => [part.type, part.value])
    );
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour),
        date: `${parts.year}-${parts.month}-${parts.day}`,
    };
}
export function birthdayMatches(
    month: number,
    day: number,
    calendar: { year: number; month: number; day: number },
    leapDay: 'feb28' | 'mar1'
) {
    if (
        month === 2 &&
        day === 29 &&
        new Date(Date.UTC(calendar.year, 1, 29)).getUTCMonth() !== 1
    )
        return leapDay === 'feb28'
            ? calendar.month === 2 && calendar.day === 28
            : calendar.month === 3 && calendar.day === 1;
    return month === calendar.month && day === calendar.day;
}
export function nextLocalDayBoundary(now: Date, timeZone: string): Date {
    const today = localCalendar(now, timeZone).date;
    let low = now.getTime(),
        high = low + 48 * 3600000;
    while (high - low > 1) {
        const middle = Math.floor((high + low) / 2);
        if (localCalendar(new Date(middle), timeZone).date === today)
            low = middle;
        else high = middle;
    }
    return new Date(high);
}

let birthdayCursor = '';
export async function queueBirthdays(now = new Date()) {
    const modules = await db.guildModuleConfig.findMany({
        where: {
            moduleId: 'birthdays',
            enabled: true,
            guildId: { gt: birthdayCursor },
        },
        take: 100,
        orderBy: { guildId: 'asc' },
    });
    birthdayCursor =
        modules.length === 100 ? modules[modules.length - 1].guildId : '';
    for (const module of modules) {
        if (!(await moduleRegistry.enabled(module.guildId, 'birthdays')))
            continue;
        const config = birthdaysConfig.parse(module.config),
            calendar = localCalendar(now, config.timeZone);
        if (!config.channelId || calendar.hour < config.hour) continue;
        const expiresAt = nextLocalDayBoundary(now, config.timeZone);
        try {
            await db.$transaction(async (tx) => {
                await lock(tx, module.guildId);
                const currentConfig = birthdaysConfig.parse(
                    await current(tx, module.guildId, 'birthdays')
                );
                if (JSON.stringify(currentConfig) !== JSON.stringify(config))
                    return;
                const members = await tx.memberBirthday.findMany({
                    where: { guildId: module.guildId },
                    take: 1000,
                });
                const existing = await tx.durableJob.findMany({
                    where: {
                        guildId: module.guildId,
                        kind: 'birthday-notice',
                        idempotencyKey: {
                            in: members.map(
                                (member) =>
                                    `birthday:${member.memberId}:${calendar.year}`
                            ),
                        },
                    },
                    select: { idempotencyKey: true },
                });
                const keys = new Set(existing.map((job) => job.idempotencyKey));
                for (const member of members
                    .filter(
                        (member) =>
                            birthdayMatches(
                                member.month,
                                member.day,
                                calendar,
                                config.leapDay
                            ) &&
                            !keys.has(
                                `birthday:${member.memberId}:${calendar.year}`
                            )
                    )
                    .slice(0, 50))
                    if (
                        birthdayMatches(
                            member.month,
                            member.day,
                            calendar,
                            config.leapDay
                        )
                    )
                        await reserve(
                            tx,
                            module.guildId,
                            member.memberId,
                            'birthdays',
                            'birthday-notice',
                            `birthday:${member.memberId}:${calendar.year}`,
                            {
                                channelId: config.channelId,
                                localDate: calendar.date,
                                year: calendar.year,
                            },
                            expiresAt
                        );
            });
        } catch {
            console.warn('Birthday reservations deferred');
        }
    }
}
const noticeInput = z
    .object({
        channelId: z.string().regex(/^\d{17,20}$/),
        memberIds: z.array(z.string()).max(5).optional(),
        localDate: z.string().optional(),
        year: z.number().optional(),
    })
    .strict();
async function notice(client: Client, job: DurableJob) {
    const birthday = job.kind === 'birthday-notice',
        moduleId = birthday ? 'birthdays' : 'afk',
        input = noticeInput.parse(job.payload);
    const actor = await utilityMember(
        client,
        job.guildId,
        job.actorId,
        moduleId
    );
    const [channel, bot] = await Promise.all([
        actor.guild.channels.fetch(input.channelId, { force: true }),
        actor.guild.members.fetchMe({ force: true }),
    ]);
    if (
        !channel ||
        channel.type !== ChannelType.GuildText ||
        !channel.permissionsFor(actor)?.has(PermissionFlagsBits.ViewChannel) ||
        !channel
            .permissionsFor(bot)
            ?.has([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
            ])
    )
        throw new Error('Member utility channel unavailable');
    if (birthday) {
        const config = birthdaysConfig.parse(
                (
                    await db.guildModuleConfig.findUniqueOrThrow({
                        where: {
                            guildId_moduleId: {
                                guildId: job.guildId,
                                moduleId,
                            },
                        },
                    })
                ).config
            ),
            calendar = localCalendar(new Date(), config.timeZone);
        const profile = await db.memberBirthday.findUnique({
            where: {
                guildId_memberId: {
                    guildId: job.guildId,
                    memberId: job.actorId,
                },
            },
        });
        if (
            !profile ||
            config.channelId !== channel.id ||
            calendar.date !== input.localDate ||
            calendar.year !== input.year ||
            !birthdayMatches(
                profile.month,
                profile.day,
                calendar,
                config.leapDay
            )
        )
            return null;
        return {
            channel,
            content: `Happy birthday, ${actor.displayName}!`,
            users: [] as string[],
        };
    }
    const absent = await db.memberAfk.findMany({
        where: {
            guildId: job.guildId,
            memberId: { in: input.memberIds ?? [] },
            expiresAt: { gt: new Date() },
        },
    });
    const lines: string[] = [];
    for (const row of absent) {
        const member = await utilityMember(
            client,
            job.guildId,
            row.memberId,
            moduleId
        );
        if (
            channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)
        )
            lines.push(`${member.displayName} is away: ${row.reason}`);
    }
    return lines.length
        ? { channel, content: lines.join('\n'), users: [] as string[] }
        : null;
}
export function memberNoticeHandler(client: Client): JobHandler {
    return {
        authorize: async (job) => !!(await notice(client, job)),
        execute: async (job) => {
            return db.$transaction(
                async (tx) => {
                    await lock(tx, job.guildId);
                    await current(
                        tx,
                        job.guildId,
                        job.kind === 'birthday-notice' ? 'birthdays' : 'afk'
                    );
                    const target = await notice(client, job);
                    if (!target)
                        return {
                            state: 'CANCELLED',
                            reason: 'Member sharing or notice eligibility changed',
                        };
                    const message = await target.channel.send({
                        content: target.content,
                        allowedMentions: { parse: [], users: target.users },
                    });
                    return {
                        state: 'DELIVERED',
                        result: {
                            messageId: message.id,
                            channelId: target.channel.id,
                        },
                    };
                },
                { timeout: 60000 }
            );
        },
        reconcile: () =>
            Promise.resolve({
                state: 'RECONCILE',
                reason: 'Member notice receipt uncertain; inspect channel, do not replay',
            }),
    };
}
export async function maintainMemberUtilities() {
    await db.memberAfk.deleteMany({
        where: { expiresAt: { lte: new Date() } },
    });
    const where = {
        kind: { in: ['afk-notice', 'birthday-notice'] },
        state: { in: ['DELIVERED', 'FAILED', 'CANCELLED'] },
        createdAt: { lt: new Date(Date.now() - 32 * 86400000) },
    };
    await db.$transaction(async (tx) => {
        await tx.jobAttempt.deleteMany({ where: { job: where } });
        await tx.durableJob.deleteMany({ where });
    });
    await queueBirthdays();
}
export function registerMemberUtilityEvents(client: Client) {
    client.on('messageCreate', (message) => {
        void observeAfkMessage(message).catch(() =>
            console.warn('AFK observation failed')
        );
    });
    client.on('guildMemberRemove', (member) => {
        void Promise.all([
            db.memberAfk.deleteMany({
                where: { guildId: member.guild.id, memberId: member.id },
            }),
            removeBirthday(member.guild.id, member.id),
        ]).catch(() => console.warn('Member utility removal failed'));
    });
}
export const memberUtilityCommands = [
    new SlashCommandBuilder()
        .setName('afk')
        .setDescription('Share a temporary away status')
        .addSubcommand((s) =>
            s
                .setName('set')
                .setDescription('Share a reason until you speak or it expires')
                .addStringOption((o) =>
                    o
                        .setName('reason')
                        .setDescription(
                            'Public away reason; no private details'
                        )
                        .setMaxLength(160)
                        .setRequired(true)
                )
                .addIntegerOption((o) =>
                    o
                        .setName('hours')
                        .setDescription('Expire after 1–24 hours')
                        .setMinValue(1)
                        .setMaxValue(24)
                )
        )
        .addSubcommand((s) =>
            s.setName('clear').setDescription('Remove your away status')
        )
        .addSubcommand((s) =>
            s
                .setName('status')
                .setDescription('Read a member’s shared away status')
                .addUserOption((o) =>
                    o
                        .setName('member')
                        .setDescription('Member; defaults to you')
                )
        ),
    new SlashCommandBuilder()
        .setName('birthday')
        .setDescription('Choose whether to share your birthday month and day')
        .addSubcommand((s) =>
            s
                .setName('set')
                .setDescription(
                    'Opt in to a birthday message; no year is stored'
                )
                .addIntegerOption((o) =>
                    o
                        .setName('month')
                        .setDescription('Month 1–12')
                        .setMinValue(1)
                        .setMaxValue(12)
                        .setRequired(true)
                )
                .addIntegerOption((o) =>
                    o
                        .setName('day')
                        .setDescription('Day of month')
                        .setMinValue(1)
                        .setMaxValue(31)
                        .setRequired(true)
                )
                .addBooleanOption((o) =>
                    o
                        .setName('share')
                        .setDescription(
                            'Agree to a message in the server birthday channel'
                        )
                        .setRequired(true)
                )
        )
        .addSubcommand((s) =>
            s
                .setName('remove')
                .setDescription(
                    'Delete your month/day and cancel pending messages'
                )
        )
        .addSubcommand((s) =>
            s.setName('status').setDescription('Read your sharing settings')
        ),
].map((command) => command.setContexts(0).setIntegrationTypes(0).toJSON());
export async function routeMemberUtilities(
    interaction: Interaction
): Promise<boolean> {
    if (
        !interaction.isChatInputCommand() ||
        !['afk', 'birthday'].includes(interaction.commandName)
    )
        return false;
    if (!interaction.guild) throw new Error('Server required');
    const guildId = interaction.guild.id,
        memberId = interaction.user.id,
        action = interaction.options.getSubcommand();
    // Removal remains available after disablement so members can withdraw sharing.
    if (interaction.commandName === 'birthday' && action === 'remove') {
        await removeBirthday(guildId, memberId);
        await interaction.editReply('Your birthday sharing data was removed.');
        return true;
    }
    if (interaction.commandName === 'afk' && action === 'clear') {
        await db.memberAfk.deleteMany({ where: { guildId, memberId } });
        await interaction.editReply('Your away status was removed.');
        return true;
    }
    await utilityMember(
        interaction.client,
        guildId,
        memberId,
        interaction.commandName === 'afk' ? 'afk' : 'birthdays'
    );
    if (interaction.commandName === 'afk') {
        if (action === 'set') {
            await setAfk(
                interaction.client,
                guildId,
                memberId,
                interaction.options.getString('reason', true),
                interaction.options.getInteger('hours') ?? 24
            );
            await interaction.editReply(
                'Your away status is shared in this server. It clears when you speak or expires.'
            );
        } else {
            const target =
                interaction.options.getUser('member')?.id ?? memberId;
            await utilityMember(interaction.client, guildId, target, 'afk');
            const row = await db.memberAfk.findFirst({
                where: {
                    guildId,
                    memberId: target,
                    expiresAt: { gt: new Date() },
                },
            });
            await interaction.editReply({
                content: row
                    ? `Away: ${row.reason}`
                    : 'No current away status.',
                allowedMentions: { parse: [] },
            });
        }
    } else if (action === 'set') {
        const input = {
            month: interaction.options.getInteger('month', true),
            day: interaction.options.getInteger('day', true),
            share: interaction.options.getBoolean('share', true),
        };
        if (!birthdayInput.safeParse(input).success) {
            await interaction.editReply(
                'Use a valid month and day and choose share:true to opt in to the server greeting. No birth year is needed.'
            );
            return true;
        }
        await setBirthday(interaction.client, guildId, memberId, input);
        await interaction.editReply(
            'Your month and day are saved for the server birthday channel. Use /birthday remove to withdraw sharing.'
        );
    } else {
        const row = await db.memberBirthday.findUnique({
            where: { guildId_memberId: { guildId, memberId } },
        });
        await interaction.editReply(
            row
                ? `You share birthday month ${row.month}, day ${row.day}. No birth year is stored.`
                : 'You are not sharing a birthday.'
        );
    }
    return true;
}
