import { createHash, randomInt } from 'node:crypto';

import { Prisma } from '@prisma/client';
import {
    AttachmentBuilder,
    Client,
    Interaction,
    SlashCommandBuilder,
} from 'discord.js';
import { z } from 'zod';

import { db } from '../db';
import { economyCatalog, economyItemId } from '../economy/config';
import {
    EconomyRequest,
    economyMember,
    validateEconomyRequest,
} from '../economy/engine';
import { escrowQuantity, returnTrade } from '../economy/escrow';

import {
    eightBallAnswers,
    entertainmentConfig,
    originalJokes,
    templateId,
} from './catalog';
import { renderTemplate } from './images';

export class EntertainmentError extends Error {}
export async function currentEntertainment(
    tx: Prisma.TransactionClient,
    guildId: string,
    collection = false
) {
    const [installation, settings, economy] = await Promise.all([
        tx.guildInstallation.findUnique({ where: { guildId } }),
        tx.guildModuleConfig.findUnique({
            where: { guildId_moduleId: { guildId, moduleId: 'entertainment' } },
        }),
        collection
            ? tx.guildModuleConfig.findUnique({
                  where: { guildId_moduleId: { guildId, moduleId: 'economy' } },
              })
            : Promise.resolve(null),
    ]);
    if (!installation?.active || !settings?.enabled || settings.version !== 1)
        throw new EntertainmentError('Entertainment disabled');
    const config = entertainmentConfig.parse(settings.config);
    if (
        collection &&
        (!config.collectionsEnabled ||
            !economy?.enabled ||
            economy.version !== 1)
    )
        throw new EntertainmentError(
            'Collections require enabled entertainment and economy'
        );
    return config;
}
const playSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('joke') }).strict(),
    z.object({ type: z.literal('eightball') }).strict(),
    z
        .object({
            type: z.literal('dice'),
            sides: z.number().int().min(2).max(100),
        })
        .strict(),
    z
        .object({
            type: z.literal('meme'),
            template: templateId,
            caption: z.string().trim().min(1).max(60),
        })
        .strict(),
    z.object({ type: z.literal('collect') }).strict(),
]);
export async function playEntertainment(
    client: Client,
    input: EconomyRequest,
    raw: unknown
) {
    const request = validateEconomyRequest(input),
        action = playSchema.parse(raw);
    await economyMember(client, request.guildId, request.actorId);
    const fingerprint = createHash('sha256')
        .update(JSON.stringify(action))
        .digest('hex');
    return db.$transaction(
        async (tx) => {
            const { guildId, actorId, requestId } = request;
            await tx.$queryRaw(
                Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
            );
            const config = await currentEntertainment(
                tx,
                guildId,
                action.type === 'collect'
            );
            if (
                await tx.user.count({
                    where: { discordId: actorId, role: 'BANNED' },
                })
            )
                throw new EntertainmentError('Account unavailable');
            if (
                action.type === 'meme' &&
                !config.approvedTemplates.includes(action.template)
            )
                throw new EntertainmentError(
                    'This template has not been approved for this server'
                );
            const prior = await tx.entertainmentReceipt.findUnique({
                where: { guildId_requestId: { guildId, requestId } },
            });
            if (prior) {
                if (
                    prior.memberId !== actorId ||
                    prior.fingerprint !== fingerprint
                )
                    throw new EntertainmentError('Request already used');
                return prior;
            }
            if (
                (await tx.entertainmentReceipt.count({ where: { guildId } })) >=
                10000
            )
                throw new EntertainmentError(
                    'Entertainment receipt capacity reached'
                );
            if (
                (await tx.entertainmentReceipt.count({
                    where: {
                        guildId,
                        memberId: actorId,
                        createdAt: { gte: new Date(Date.now() - 60000) },
                    },
                })) >= 5
            )
                throw new EntertainmentError(
                    'Wait before another request (five per minute)'
                );
            let result = '';
            if (action.type === 'joke')
                result = originalJokes[randomInt(originalJokes.length)];
            if (action.type === 'eightball')
                result = eightBallAnswers[randomInt(eightBallAnswers.length)];
            if (action.type === 'dice')
                result = `Rolled ${randomInt(1, action.sides + 1)} on a ${action.sides}-sided die.`;
            if (action.type === 'meme') result = action.template;
            if (action.type === 'collect') {
                const key = { guildId, memberId: actorId },
                    account = await tx.economyAccount.findUnique({
                        where: { guildId_memberId: key },
                    }),
                    now = new Date();
                if (!account?.optedIn)
                    throw new EntertainmentError(
                        'Use /economy join to opt in first'
                    );
                if (
                    account.lastCollectionAt?.toISOString().slice(0, 10) ===
                    now.toISOString().slice(0, 10)
                )
                    throw new EntertainmentError(
                        'Collection claim already used today (UTC)'
                    );
                const available: string[] = [];
                for (const id of Object.keys(economyCatalog)) {
                    const inventory = await tx.economyInventory.findUnique({
                        where: {
                            guildId_memberId_itemId: { ...key, itemId: id },
                        },
                    });
                    if (
                        (inventory?.quantity ?? 0) +
                            (await escrowQuantity(tx, guildId, actorId, id)) <
                        99
                    )
                        available.push(id);
                }
                if (!available.length)
                    throw new EntertainmentError('Collection is full');
                result = available[randomInt(available.length)];
                const itemKey = { ...key, itemId: result };
                await tx.economyInventory.upsert({
                    where: { guildId_memberId_itemId: itemKey },
                    create: { ...itemKey, quantity: 1 },
                    update: { quantity: { increment: 1 } },
                });
                await tx.economyAccount.update({
                    where: { guildId_memberId: key },
                    data: { lastCollectionAt: now },
                });
            }
            return tx.entertainmentReceipt.create({
                data: {
                    guildId,
                    memberId: actorId,
                    requestId,
                    fingerprint,
                    kind: action.type,
                    result,
                },
            });
        },
        { maxWait: 10000, timeout: 10000 }
    );
}
const offerSchema = z
    .object({
        buyerId: z.string().regex(/^\d{17,20}$/),
        itemId: economyItemId,
        quantity: z.number().int().min(1).max(10),
        price: z.number().int().min(0).max(100000),
    })
    .strict();
export async function offerTrade(
    client: Client,
    input: EconomyRequest,
    raw: unknown
) {
    const request = validateEconomyRequest(input),
        offer = offerSchema.parse(raw);
    if (offer.buyerId === request.actorId)
        throw new EntertainmentError('Choose another member');
    await Promise.all([
        economyMember(client, request.guildId, request.actorId),
        economyMember(client, request.guildId, offer.buyerId),
    ]);
    return db.$transaction(
        async (tx) => {
            const { guildId, actorId, requestId } = request;
            await tx.$queryRaw(
                Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
            );
            await currentEntertainment(tx, guildId, true);
            const prior = await tx.collectionTrade.findUnique({
                where: { guildId_requestId: { guildId, requestId } },
            });
            if (prior) {
                if (
                    prior.sellerId !== actorId ||
                    prior.buyerId !== offer.buyerId ||
                    prior.itemId !== offer.itemId ||
                    prior.quantity !== offer.quantity ||
                    prior.price !== offer.price
                )
                    throw new EntertainmentError('Request already used');
                return prior;
            }
            if (
                await tx.user.count({
                    where: {
                        discordId: { in: [actorId, offer.buyerId] },
                        role: 'BANNED',
                    },
                })
            )
                throw new EntertainmentError('Account unavailable');
            for (const id of [actorId, offer.buyerId])
                if (
                    !(
                        await tx.economyAccount.findUnique({
                            where: {
                                guildId_memberId: { guildId, memberId: id },
                            },
                        })
                    )?.optedIn
                )
                    throw new EntertainmentError('Both members must opt in');
            if (
                (await tx.collectionTrade.count({ where: { guildId } })) >= 1000
            )
                throw new EntertainmentError('Trade capacity reached');
            if (
                (await tx.collectionTrade.count({
                    where: { guildId, sellerId: actorId, state: 'PENDING' },
                })) >= 5 ||
                (await tx.collectionTrade.count({
                    where: {
                        guildId,
                        buyerId: offer.buyerId,
                        state: 'PENDING',
                    },
                })) >= 5
            )
                throw new EntertainmentError(
                    'Five pending offers per sender or recipient'
                );
            if (
                (await tx.collectionTrade.count({
                    where: {
                        guildId,
                        sellerId: actorId,
                        createdAt: { gte: new Date(Date.now() - 86400000) },
                    },
                })) >= 50
            )
                throw new EntertainmentError('Daily offer limit reached');
            const key = { guildId, memberId: actorId, itemId: offer.itemId },
                inventory = await tx.economyInventory.findUnique({
                    where: { guildId_memberId_itemId: key },
                });
            if (!inventory || inventory.quantity < offer.quantity)
                throw new EntertainmentError(
                    'Insufficient unreserved inventory'
                );
            await tx.economyInventory.update({
                where: { guildId_memberId_itemId: key },
                data: { quantity: { decrement: offer.quantity } },
            });
            return tx.collectionTrade.create({
                data: {
                    guildId,
                    sellerId: actorId,
                    ...offer,
                    requestId,
                    expiresAt: new Date(Date.now() + 900000),
                },
            });
        },
        { maxWait: 10000, timeout: 10000 }
    );
}
export async function respondTrade(
    client: Client,
    input: EconomyRequest,
    id: string,
    decision: 'accept' | 'cancel'
) {
    const request = validateEconomyRequest(input);
    z.string().uuid().parse(id);
    await economyMember(
        client,
        request.guildId,
        request.actorId,
        decision === 'cancel'
    );
    const observed = await db.collectionTrade.findFirstOrThrow({
        where: { id, guildId: request.guildId },
    });
    if (decision === 'accept')
        await Promise.all([
            economyMember(client, request.guildId, observed.sellerId),
            economyMember(client, request.guildId, observed.buyerId),
        ]);
    return db.$transaction(
        async (tx) => {
            const { guildId, actorId } = request;
            await tx.$queryRaw(
                Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
            );
            const trade = await tx.collectionTrade.findFirstOrThrow({
                where: { id, guildId },
            });
            if (actorId !== trade.buyerId && actorId !== trade.sellerId)
                throw new EntertainmentError('Offer belongs to other members');
            if (decision === 'accept' && actorId !== trade.buyerId)
                throw new EntertainmentError('Only the named buyer may accept');
            if (trade.state !== 'PENDING') return trade;
            if (decision === 'cancel')
                return returnTrade(
                    tx,
                    trade,
                    actorId === trade.sellerId ? 'CANCELLED' : 'DECLINED'
                );
            await currentEntertainment(tx, guildId, true);
            if (
                await tx.user.count({
                    where: {
                        discordId: { in: [trade.sellerId, trade.buyerId] },
                        role: 'BANNED',
                    },
                })
            )
                throw new EntertainmentError('Account unavailable');
            if (trade.expiresAt <= new Date())
                return returnTrade(tx, trade, 'EXPIRED');
            const seller = await tx.economyAccount.findUniqueOrThrow({
                    where: {
                        guildId_memberId: { guildId, memberId: trade.sellerId },
                    },
                }),
                buyer = await tx.economyAccount.findUniqueOrThrow({
                    where: {
                        guildId_memberId: { guildId, memberId: trade.buyerId },
                    },
                });
            if (!seller.optedIn || !buyer.optedIn)
                throw new EntertainmentError('Both members must opt in');
            if (
                buyer.balance < trade.price ||
                seller.balance + trade.price > 1000000
            )
                throw new EntertainmentError('Trade exceeds balance limits');
            const key = {
                    guildId,
                    memberId: trade.buyerId,
                    itemId: trade.itemId,
                },
                inventory = await tx.economyInventory.findUnique({
                    where: { guildId_memberId_itemId: key },
                });
            if (
                (inventory?.quantity ?? 0) +
                    trade.quantity +
                    (await escrowQuantity(
                        tx,
                        guildId,
                        trade.buyerId,
                        trade.itemId
                    )) >
                99
            )
                throw new EntertainmentError('Buyer inventory limit reached');
            if ((await tx.economyEntry.count({ where: { guildId } })) > 99998)
                throw new EntertainmentError('Ledger capacity reached');
            await tx.economyAccount.update({
                where: {
                    guildId_memberId: { guildId, memberId: trade.sellerId },
                },
                data: { balance: { increment: trade.price } },
            });
            await tx.economyAccount.update({
                where: {
                    guildId_memberId: { guildId, memberId: trade.buyerId },
                },
                data: { balance: { decrement: trade.price } },
            });
            await tx.economyInventory.upsert({
                where: { guildId_memberId_itemId: key },
                create: { ...key, quantity: trade.quantity },
                update: { quantity: { increment: trade.quantity } },
            });
            for (const [memberId, delta, balanceAfter] of [
                [trade.sellerId, trade.price, seller.balance + trade.price],
                [trade.buyerId, -trade.price, buyer.balance - trade.price],
            ] as const) {
                await tx.economyEntry.create({
                    data: {
                        guildId,
                        memberId,
                        actorId,
                        requestId: `trade:${trade.id}:${memberId}`,
                        kind: 'TRADE',
                        fingerprint: trade.id,
                        delta,
                        balanceAfter,
                        reason: `Trade ${trade.id}: ${trade.quantity} ${trade.itemId}`,
                    },
                });
            }
            return tx.collectionTrade.update({
                where: { id },
                data: { state: 'ACCEPTED', completedAt: new Date() },
            });
        },
        { maxWait: 10000, timeout: 10000 }
    );
}
let expiryCursor: string | undefined;
export async function maintainEntertainment(now = new Date()) {
    let expired = await db.collectionTrade.findMany({
        where: {
            state: 'PENDING',
            expiresAt: { lte: now },
            ...(expiryCursor ? { id: { gt: expiryCursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: 100,
    });
    if (!expired.length && expiryCursor) {
        expiryCursor = undefined;
        expired = await db.collectionTrade.findMany({
            where: { state: 'PENDING', expiresAt: { lte: now } },
            orderBy: { id: 'asc' },
            take: 100,
        });
    }
    for (const observed of expired) {
        expiryCursor = observed.id;
        try {
            await db.$transaction(async (tx) => {
                await tx.$queryRaw(
                    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${observed.guildId})::bigint)::text`
                );
                const trade = await tx.collectionTrade.findUnique({
                    where: { id: observed.id },
                });
                if (trade?.state === 'PENDING' && trade.expiresAt <= now)
                    await returnTrade(tx, trade, 'EXPIRED');
            });
        } catch {
            console.warn(
                'Collection reservation expiry failed; retained for retry'
            );
        }
    }
    const receiptBefore = new Date(now.getTime() - 7 * 86400000),
        tradeBefore = new Date(now.getTime() - 30 * 86400000);
    await db.$executeRaw`DELETE FROM "EntertainmentReceipt" WHERE "id" IN (SELECT "id" FROM "EntertainmentReceipt" WHERE "createdAt" < ${receiptBefore} ORDER BY "createdAt" LIMIT 1000)`;
    await db.$executeRaw`DELETE FROM "CollectionTrade" WHERE "id" IN (SELECT "id" FROM "CollectionTrade" WHERE "state" <> 'PENDING' AND "completedAt" < ${tradeBefore} ORDER BY "completedAt" LIMIT 1000)`;
}

export const funCommand = new SlashCommandBuilder()
    .setName('fun')
    .setDescription('Private original jokes, images and collections')
    .setContexts(0)
    .setIntegrationTypes(0)
    .addSubcommand((o) =>
        o.setName('joke').setDescription('An original community joke')
    )
    .addSubcommand((o) =>
        o.setName('eightball').setDescription('An entertainment-only answer')
    )
    .addSubcommand((o) =>
        o
            .setName('dice')
            .setDescription('Roll a die')
            .addIntegerOption((p) =>
                p
                    .setName('sides')
                    .setDescription('Number of sides (default six)')
                    .setMinValue(2)
                    .setMaxValue(100)
            )
    )
    .addSubcommand((o) =>
        o
            .setName('meme')
            .setDescription('Caption a manager-approved original template')
            .addStringOption((p) =>
                p
                    .setName('template')
                    .setDescription('Original layout')
                    .setRequired(true)
                    .addChoices(
                        ...templateId.options.map((id) => ({
                            name: id,
                            value: id,
                        }))
                    )
            )
            .addStringOption((p) =>
                p
                    .setName('caption')
                    .setDescription('Your caption')
                    .setRequired(true)
                    .setMaxLength(60)
            )
    )
    .addSubcommand((o) =>
        o
            .setName('collect')
            .setDescription('Claim one fictional collection object per UTC day')
    )
    .toJSON();
export const tradeCommand = new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Private opt-in fictional collection trades')
    .setContexts(0)
    .setIntegrationTypes(0)
    .addSubcommand((o) =>
        o
            .setName('offer')
            .setDescription(
                'Reserve items for a named buyer; expires in fifteen minutes'
            )
            .addUserOption((p) =>
                p
                    .setName('buyer')
                    .setDescription('Participating buyer')
                    .setRequired(true)
            )
            .addStringOption((p) =>
                p
                    .setName('item')
                    .setDescription('Collection item ID')
                    .setRequired(true)
                    .addChoices(
                        ...economyItemId.options.map((id) => ({
                            name: id,
                            value: id,
                        }))
                    )
            )
            .addIntegerOption((p) =>
                p
                    .setName('quantity')
                    .setDescription('Quantity')
                    .setRequired(true)
                    .setMinValue(1)
                    .setMaxValue(10)
            )
            .addIntegerOption((p) =>
                p
                    .setName('price')
                    .setDescription(
                        'Total fictional points price; zero for a gift'
                    )
                    .setRequired(true)
                    .setMinValue(0)
                    .setMaxValue(100000)
            )
    )
    .addSubcommand((o) =>
        o.setName('list').setDescription('Show your latest offers')
    )
    .addSubcommand((o) =>
        o
            .setName('accept')
            .setDescription('Named buyer: accept an offer')
            .addStringOption((p) =>
                p.setName('id').setDescription('Offer ID').setRequired(true)
            )
    )
    .addSubcommand((o) =>
        o
            .setName('cancel')
            .setDescription(
                'Seller cancels or buyer declines; return reserved items'
            )
            .addStringOption((p) =>
                p.setName('id').setDescription('Offer ID').setRequired(true)
            )
    )
    .toJSON();
export async function routeEntertainment(interaction: Interaction) {
    if (
        !interaction.isChatInputCommand() ||
        !['fun', 'trade'].includes(interaction.commandName)
    )
        return false;
    if (!interaction.guildId) throw new EntertainmentError('Server required');
    const input = {
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            requestId: interaction.id,
        },
        sub = interaction.options.getSubcommand();
    try {
        if (interaction.commandName === 'fun') {
            const raw =
                sub === 'dice'
                    ? {
                          type: sub,
                          sides: interaction.options.getInteger('sides') ?? 6,
                      }
                    : sub === 'meme'
                      ? {
                            type: sub,
                            template: interaction.options.getString(
                                'template',
                                true
                            ),
                            caption: interaction.options.getString(
                                'caption',
                                true
                            ),
                        }
                      : { type: sub };
            const result = await playEntertainment(
                interaction.client,
                input,
                raw
            );
            if (sub === 'meme')
                await interaction.editReply({
                    content: 'Original server-approved Backline template.',
                    files: [
                        new AttachmentBuilder(
                            await renderTemplate(
                                result.result,
                                interaction.options.getString('caption', true)
                            ),
                            { name: `backline-${result.result}.png` }
                        ),
                    ],
                    allowedMentions: { parse: [] },
                });
            else
                await interaction.editReply({
                    content:
                        sub === 'collect'
                            ? `Added one ${result.result} to your fictional collection.`
                            : result.result,
                    allowedMentions: { parse: [] },
                });
        } else if (sub === 'list') {
            await economyMember(
                interaction.client,
                input.guildId,
                input.actorId,
                true
            );
            const trades = await db.collectionTrade.findMany({
                where: {
                    guildId: input.guildId,
                    OR: [
                        { sellerId: input.actorId },
                        { buyerId: input.actorId },
                    ],
                },
                orderBy: { createdAt: 'desc' },
                take: 10,
            });
            await interaction.editReply(
                trades
                    .map(
                        (t) =>
                            `${t.id}: ${t.quantity} ${t.itemId}, ${t.price} points · ${t.state} · seller ${t.sellerId} → buyer ${t.buyerId}`
                    )
                    .join('\n') || 'No retained offers.'
            );
        } else {
            const trade =
                sub === 'offer'
                    ? await offerTrade(interaction.client, input, {
                          buyerId: interaction.options.getUser('buyer', true)
                              .id,
                          itemId: interaction.options.getString('item', true),
                          quantity: interaction.options.getInteger(
                              'quantity',
                              true
                          ),
                          price: interaction.options.getInteger('price', true),
                      })
                    : await respondTrade(
                          interaction.client,
                          input,
                          interaction.options.getString('id', true),
                          sub === 'accept' ? 'accept' : 'cancel'
                      );
            await interaction.editReply(
                `Offer ${trade.id}: ${trade.state}. ${trade.quantity} ${trade.itemId}, ${trade.price} fictional points. No notification was sent; the buyer can use /trade list.`
            );
        }
    } catch (error) {
        await interaction.editReply(
            error instanceof EntertainmentError
                ? error.message
                : 'Entertainment action unavailable. Check the settings and try again.'
        );
    }
    return true;
}
