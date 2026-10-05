import { createHash, randomInt } from 'node:crypto';

import { Prisma } from '@prisma/client';
import {
    Client,
    Interaction,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';
import { z } from 'zod';

import { db } from '../db';
import { moduleRegistry } from '../modules/registry';
import { env } from '../utils/env';

import { economyCatalog, economyConfig, economyItemId } from './config';

const snowflake = z.string().regex(/^\d{17,20}$/);
const actionSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('join') }).strict(),
    z.object({ type: z.literal('leave') }).strict(),
    z.object({ type: z.literal('daily') }).strict(),
    z
        .object({
            type: z.literal('coin'),
            side: z.enum(['heads', 'tails']),
            bet: z.number().int().min(0).max(100),
        })
        .strict(),
    z
        .object({
            type: z.literal('buy'),
            itemId: economyItemId,
            quantity: z.number().int().min(1).max(10),
        })
        .strict(),
    z
        .object({
            type: z.literal('adjust'),
            memberId: snowflake,
            amount: z
                .number()
                .int()
                .min(-1000000)
                .max(1000000)
                .refine((x) => x !== 0),
            reason: z.string().trim().min(1).max(200),
        })
        .strict(),
]);
type Action = z.infer<typeof actionSchema>;
class EconomyError extends Error {}
export type EconomyRequest = {
    guildId: string;
    actorId: string;
    requestId: string;
};
function validateRequest(input: EconomyRequest) {
    const request = z
        .object({
            guildId: snowflake,
            actorId: snowflake,
            requestId: snowflake,
        })
        .strict()
        .parse(input);
    const created =
        Number(BigInt(request.requestId) >> BigInt(22)) + 1420070400000;
    const age = Date.now() - created;
    if (age < -10000 || age > 300000)
        throw new EconomyError('Economy request expired');
    return request;
}
export async function economyMember(
    client: Client,
    guildId: string,
    memberId: string,
    allowWithdrawal = false
) {
    if (env.BOT_GUILD_IDS.length && !env.BOT_GUILD_IDS.includes(guildId))
        throw new EconomyError('Server excluded by operator');
    const installation = await db.guildInstallation.findUnique({
        where: { guildId },
    });
    if (!installation?.active)
        throw new EconomyError('Installation unavailable');
    const guild = await client.guilds.fetch({ guild: guildId, force: true });
    const [member, account] = await Promise.all([
        guild.members.fetch({ user: memberId, force: true }),
        db.user.findUnique({
            where: { discordId: memberId },
            select: { role: true },
        }),
    ]);
    if (member.user.bot || (!allowWithdrawal && account?.role === 'BANNED'))
        throw new EconomyError('Account unavailable');
    return member;
}
export async function economyAction(
    client: Client,
    input: EconomyRequest,
    raw: unknown
) {
    const request = validateRequest(input),
        action = actionSchema.parse(raw);
    const member = await economyMember(
        client,
        request.guildId,
        request.actorId,
        action.type === 'leave'
    );
    const memberId =
        action.type === 'adjust' ? action.memberId : request.actorId;
    if (action.type === 'adjust') {
        if (!member.permissions.has(PermissionFlagsBits.ManageGuild))
            throw new EconomyError('Current Manage Server permission required');
        await economyMember(client, request.guildId, memberId);
    }
    const fingerprint = createHash('sha256')
        .update(JSON.stringify(action))
        .digest('hex');
    return db.$transaction(
        async (tx) => {
            const { guildId, actorId, requestId } = request;
            await tx.$queryRaw(
                Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
            );
            const installation = await tx.guildInstallation.findUnique({
                where: { guildId },
            });
            const settings = await tx.guildModuleConfig.findUnique({
                where: { guildId_moduleId: { guildId, moduleId: 'economy' } },
            });
            if (
                !installation?.active ||
                (action.type !== 'leave' &&
                    (!settings?.enabled || settings.version !== 1))
            )
                throw new EconomyError('Economy disabled');
            if (
                action.type !== 'leave' &&
                (await tx.user.count({
                    where: {
                        discordId: { in: [actorId, memberId] },
                        role: 'BANNED',
                    },
                }))
            )
                throw new EconomyError('Account unavailable');
            const config = economyConfig.parse(settings?.config ?? {});
            const prior = await tx.economyEntry.findUnique({
                where: { guildId_requestId: { guildId, requestId } },
            });
            if (prior) {
                if (
                    prior.memberId !== memberId ||
                    prior.actorId !== actorId ||
                    prior.fingerprint !== fingerprint
                )
                    throw new EconomyError('Request already used');
                return prior;
            }
            const key = { guildId, memberId };
            let account = await tx.economyAccount.findUnique({
                where: { guildId_memberId: key },
            });
            if (!account && action.type === 'leave')
                return {
                    id: requestId,
                    guildId,
                    memberId,
                    actorId,
                    requestId,
                    kind: 'LEAVE',
                    fingerprint,
                    delta: 0,
                    balanceAfter: 0,
                    reason: 'leave',
                    createdAt: new Date(),
                };
            if (!account) {
                if (action.type !== 'join')
                    throw new EconomyError('Use /economy join to opt in first');
                if (
                    (await tx.economyAccount.count({ where: { guildId } })) >=
                    1000
                )
                    throw new EconomyError('Account capacity reached');
                account = await tx.economyAccount.create({ data: key });
            }
            if (action.type === 'join' || action.type === 'leave') {
                if (
                    account.optRequestId &&
                    BigInt(account.optRequestId) > BigInt(requestId)
                )
                    throw new EconomyError(
                        'A newer participation change exists'
                    );
                if (
                    account.optRequestId === requestId &&
                    account.optedIn !== (action.type === 'join')
                )
                    throw new EconomyError('Request already used');
                await tx.economyAccount.update({
                    where: { guildId_memberId: key },
                    data: {
                        optedIn: action.type === 'join',
                        optRequestId: requestId,
                    },
                });
                return {
                    id: requestId,
                    guildId,
                    memberId,
                    actorId,
                    requestId,
                    kind: action.type.toUpperCase(),
                    fingerprint,
                    delta: 0,
                    balanceAfter: account.balance,
                    reason: action.type,
                    createdAt: new Date(),
                };
            }
            if (account.optRequestId === requestId)
                throw new EconomyError('Request already used');
            if ((await tx.economyEntry.count({ where: { guildId } })) >= 100000)
                throw new EconomyError('Ledger capacity reached');
            if (
                (await tx.economyEntry.count({
                    where: {
                        guildId,
                        actorId,
                        createdAt: { gte: new Date(Date.now() - 60000) },
                    },
                })) >= 10
            )
                throw new EconomyError(
                    'Wait before another economy action (ten per minute)'
                );
            if (!account.optedIn)
                throw new EconomyError('Member has opted out');
            let delta = 0,
                reason: string = action.type;
            const data: Prisma.EconomyAccountUpdateInput = {};
            const now = new Date();
            if (action.type === 'daily') {
                if (
                    account.lastDailyAt?.toISOString().slice(0, 10) ===
                    now.toISOString().slice(0, 10)
                )
                    throw new EconomyError(
                        'Daily reward already claimed today (UTC)'
                    );
                delta = config.dailyReward;
                data.lastDailyAt = now;
                reason = 'UTC daily reward';
            }
            if (action.type === 'coin') {
                if (!config.gamesEnabled)
                    throw new EconomyError('Economy games disabled');
                if (
                    account.lastPlayedAt &&
                    now.getTime() - account.lastPlayedAt.getTime() < 10000
                )
                    throw new EconomyError('Wait ten seconds between games');
                if (
                    account.balance < action.bet ||
                    account.balance + action.bet > 1000000
                )
                    throw new EconomyError('Bet exceeds balance limits');
                const outcome = randomInt(2) === 0 ? 'heads' : 'tails';
                delta = outcome === action.side ? action.bet : -action.bet;
                reason = `Coin: ${outcome}; selected ${action.side}; bet ${action.bet}`;
                data.lastPlayedAt = now;
            }
            if (action.type === 'buy') {
                if (!config.shopEnabled)
                    throw new EconomyError('Economy shop disabled');
                const item = economyCatalog[action.itemId];
                delta = -item.price * action.quantity;
                if (account.balance + delta < 0)
                    throw new EconomyError('Insufficient fictional points');
                const inventoryKey = { ...key, itemId: action.itemId };
                const inventory = await tx.economyInventory.findUnique({
                    where: { guildId_memberId_itemId: inventoryKey },
                });
                if ((inventory?.quantity ?? 0) + action.quantity > 99)
                    throw new EconomyError('Inventory limit reached');
                await tx.economyInventory.upsert({
                    where: { guildId_memberId_itemId: inventoryKey },
                    create: { ...inventoryKey, quantity: action.quantity },
                    update: { quantity: { increment: action.quantity } },
                });
                reason = `Purchased ${action.quantity} ${item.name}`;
            }
            if (action.type === 'adjust') {
                delta = action.amount;
                reason = action.reason;
            }
            const balance = account.balance + delta;
            if (balance < 0 || balance > 1000000)
                throw new EconomyError(
                    'Balance must stay between zero and one million'
                );
            await tx.economyAccount.update({
                where: { guildId_memberId: key },
                data: { ...data, balance },
            });
            return tx.economyEntry.create({
                data: {
                    guildId,
                    memberId,
                    actorId,
                    requestId,
                    kind: action.type.toUpperCase(),
                    fingerprint,
                    delta,
                    balanceAfter: balance,
                    reason,
                },
            });
        },
        { maxWait: 10000, timeout: 10000 }
    );
}
export async function expireEconomyEntries(now = new Date()) {
    const before = new Date(now.getTime() - 90 * 86400000);
    await db.$executeRaw`DELETE FROM "EconomyEntry" WHERE "id" IN (SELECT "id" FROM "EconomyEntry" WHERE "createdAt" < ${before} ORDER BY "createdAt" LIMIT 1000)`;
}

export const economyCommand = new SlashCommandBuilder()
    .setName('economy')
    .setDescription('Opt-in fictional server points and collections')
    .setContexts(0)
    .setIntegrationTypes(0)
    .addSubcommand((o) =>
        o.setName('join').setDescription('Opt in to this server economy')
    )
    .addSubcommand((o) =>
        o
            .setName('leave')
            .setDescription(
                'Opt out; keep your existing balance and collection'
            )
    )
    .addSubcommand((o) =>
        o
            .setName('balance')
            .setDescription('Show your private balance and participation')
    )
    .addSubcommand((o) =>
        o.setName('history').setDescription('Show your latest ledger entries')
    )
    .addSubcommand((o) =>
        o.setName('inventory').setDescription('Show your fictional collection')
    )
    .addSubcommand((o) =>
        o
            .setName('shop')
            .setDescription('Show original fictional items and prices')
    )
    .addSubcommand((o) =>
        o.setName('daily').setDescription('Claim one daily reward (UTC)')
    )
    .addSubcommand((o) =>
        o
            .setName('coin')
            .setDescription('Play a fictional points coin game')
            .addStringOption((p) =>
                p
                    .setName('side')
                    .setDescription('Your choice')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Heads', value: 'heads' },
                        { name: 'Tails', value: 'tails' }
                    )
            )
            .addIntegerOption((p) =>
                p
                    .setName('bet')
                    .setDescription('Fictional points; zero for a free game')
                    .setMinValue(0)
                    .setMaxValue(100)
            )
    )
    .addSubcommand((o) =>
        o
            .setName('buy')
            .setDescription('Buy an original fictional item')
            .addStringOption((p) =>
                p
                    .setName('item')
                    .setDescription('Catalog item')
                    .setRequired(true)
                    .addChoices(
                        ...Object.entries(economyCatalog).map(([id, item]) => ({
                            name: item.name,
                            value: id,
                        }))
                    )
            )
            .addIntegerOption((p) =>
                p
                    .setName('quantity')
                    .setDescription('Quantity (default one)')
                    .setMinValue(1)
                    .setMaxValue(10)
            )
    )
    .addSubcommand((o) =>
        o
            .setName('adjust')
            .setDescription('Managers: record a balance adjustment')
            .addUserOption((p) =>
                p
                    .setName('member')
                    .setDescription('Participating member')
                    .setRequired(true)
            )
            .addIntegerOption((p) =>
                p
                    .setName('amount')
                    .setDescription('Signed fictional points adjustment')
                    .setRequired(true)
                    .setMinValue(-1000000)
                    .setMaxValue(1000000)
            )
            .addStringOption((p) =>
                p
                    .setName('reason')
                    .setDescription('Ledger reason')
                    .setRequired(true)
                    .setMaxLength(200)
            )
    )
    .toJSON();
export async function routeEconomy(interaction: Interaction) {
    if (
        !interaction.isChatInputCommand() ||
        interaction.commandName !== 'economy'
    )
        return false;
    if (!interaction.guildId) throw new EconomyError('Server required');
    const guildId = interaction.guildId,
        actorId = interaction.user.id,
        sub = interaction.options.getSubcommand();
    await economyMember(interaction.client, guildId, actorId, sub === 'leave');
    const settings = await db.guildModuleConfig.findUnique({
        where: { guildId_moduleId: { guildId, moduleId: 'economy' } },
    });
    const config = economyConfig.parse(settings?.config ?? {});
    if (['balance', 'history', 'inventory'].includes(sub)) {
        const account = await db.economyAccount.findUnique({
            where: { guildId_memberId: { guildId, memberId: actorId } },
        });
        if (!account) {
            await interaction.editReply('Use /economy join to opt in.');
            return true;
        }
        let content = `${account.balance} ${config.currencyName} · ${account.optedIn ? 'participating' : 'opted out'}`;
        if (sub === 'history') {
            const rows = await db.economyEntry.findMany({
                where: { guildId, memberId: actorId },
                orderBy: { createdAt: 'desc' },
                take: 10,
            });
            content +=
                '\n' +
                rows
                    .map(
                        (r) =>
                            `${r.kind}: ${r.delta >= 0 ? '+' : ''}${r.delta} · balance ${r.balanceAfter} · ${r.reason}`
                    )
                    .join('\n');
        }
        if (sub === 'inventory') {
            const rows = await db.economyInventory.findMany({
                where: { guildId, memberId: actorId, quantity: { gt: 0 } },
                orderBy: { itemId: 'asc' },
            });
            content +=
                '\n' +
                (rows.map((r) => `${r.itemId}: ${r.quantity}`).join('\n') ||
                    'Your collection is empty.');
        }
        await interaction.editReply({
            content: content.slice(0, 1900),
            allowedMentions: { parse: [] },
        });
        return true;
    }
    if (sub === 'shop') {
        if (
            !(await moduleRegistry.enabled(guildId, 'economy')) ||
            !config.shopEnabled
        )
            throw new EconomyError('Shop disabled');
        await interaction.editReply(
            Object.entries(economyCatalog)
                .map(
                    ([id, item]) =>
                        `${id}: ${item.name} · ${item.price} ${config.currencyName}`
                )
                .join('\n')
        );
        return true;
    }
    let action: Action;
    if (sub === 'coin')
        action = {
            type: sub,
            side: interaction.options.getString('side', true) as
                | 'heads'
                | 'tails',
            bet: interaction.options.getInteger('bet') ?? 0,
        };
    else if (sub === 'buy')
        action = {
            type: sub,
            itemId: economyItemId.parse(
                interaction.options.getString('item', true)
            ),
            quantity: interaction.options.getInteger('quantity') ?? 1,
        };
    else if (sub === 'adjust')
        action = {
            type: sub,
            memberId: interaction.options.getUser('member', true).id,
            amount: interaction.options.getInteger('amount', true),
            reason: interaction.options.getString('reason', true),
        };
    else action = actionSchema.parse({ type: sub });
    try {
        const entry = await economyAction(
            interaction.client,
            { guildId, actorId, requestId: interaction.id },
            action
        );
        await interaction.editReply({
            content: `${entry.kind}: ${entry.reason}\n${entry.delta >= 0 ? '+' : ''}${entry.delta} ${config.currencyName}; balance ${entry.balanceAfter}.\n${sub === 'leave' ? 'You have opted out.' : 'Fictional points have no cash value.'}`,
            allowedMentions: { parse: [] },
        });
    } catch (error) {
        await interaction.editReply({
            content:
                error instanceof EconomyError
                    ? error.message
                    : 'Economy action unavailable.',
            allowedMentions: { parse: [] },
        });
    }
    return true;
}
