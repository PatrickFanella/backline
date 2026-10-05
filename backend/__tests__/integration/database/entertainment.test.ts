import { Client, PermissionFlagsBits, PermissionsBitField } from 'discord.js';

import { db } from '../../../src/db';
import { economyAction } from '../../../src/economy/engine';
import {
    offerTrade,
    playEntertainment,
    respondTrade,
    maintainEntertainment,
} from '../../../src/entertainment/engine';
import { moduleRegistry } from '../../../src/modules/registry';
import { env } from '../../../src/utils/env';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('curated entertainment and trades', () => {
    const guildId = '777777777777777891',
        otherGuild = '777777777777777892',
        sellerId = '777777777777777893',
        buyerId = '777777777777777894',
        otherId = '777777777777777895';
    const client = {
        guilds: {
            fetch: jest.fn().mockResolvedValue({
                members: {
                    fetch: jest.fn(({ user }: { user: string }) =>
                        Promise.resolve({
                            id: user,
                            user: { bot: false },
                            permissions: new PermissionsBitField([
                                PermissionFlagsBits.ManageGuild,
                            ]),
                        })
                    ),
                },
            }),
        },
    } as unknown as Client;
    let sequence = 0;
    const request = (actorId = sellerId, server = guildId) => ({
        guildId: server,
        actorId,
        requestId: (
            (BigInt(Date.now() - 1420070400000) << BigInt(22)) +
            BigInt(++sequence)
        ).toString(),
    });
    let previous: string[];
    beforeAll(() => {
        previous = [...env.BOT_GUILD_IDS];
        env.BOT_GUILD_IDS.push(guildId, otherGuild);
    });
    beforeEach(async () => {
        for (const id of [guildId, otherGuild]) {
            await db.guildInstallation.create({
                data: {
                    guildId: id,
                    name: 'Entertainment fixture',
                    active: true,
                },
            });
            await moduleRegistry.configure(id, 'economy', true, {
                shopEnabled: true,
            });
            await moduleRegistry.configure(id, 'entertainment', true, {
                collectionsEnabled: true,
                approvedTemplates: ['loading'],
            });
        }
        for (const member of [sellerId, buyerId]) {
            await economyAction(client, request(member), { type: 'join' });
            await economyAction(client, request(member), { type: 'daily' });
        }
    });
    afterEach(async () => {
        const where = { guildId: { in: [guildId, otherGuild] } };
        await db.collectionTrade.deleteMany({ where });
        await db.entertainmentReceipt.deleteMany({ where });
        await db.economyInventory.deleteMany({ where });
        await db.economyEntry.deleteMany({ where });
        await db.economyAccount.deleteMany({ where });
        await db.guildModuleConfig.deleteMany({ where });
        await db.guildInstallation.deleteMany({ where });
    });
    afterAll(async () => {
        env.BOT_GUILD_IDS.splice(0, env.BOT_GUILD_IDS.length, ...previous);
        await db.$disconnect();
    });
    const offer = { buyerId, itemId: 'pin', quantity: 1, price: 30 };
    const buy = () =>
        economyAction(client, request(), {
            type: 'buy',
            itemId: 'pin',
            quantity: 1,
        });
    const inventory = (memberId = sellerId) =>
        db.economyInventory.findUniqueOrThrow({
            where: {
                guildId_memberId_itemId: { guildId, memberId, itemId: 'pin' },
            },
        });
    it('deduplicates concurrent collection claims and preserves the daily limit across opt-out/rejoin', async () => {
        const r = request();
        const values = await Promise.all([
            playEntertainment(client, r, { type: 'collect' }),
            playEntertainment(client, r, { type: 'collect' }),
        ]);
        expect(values[0].id).toBe(values[1].id);
        expect(
            await db.economyInventory.count({
                where: { guildId, memberId: sellerId },
            })
        ).toBe(1);
        await expect(
            playEntertainment(client, request(), { type: 'collect' })
        ).rejects.toThrow('already used today');
        await economyAction(client, request(), { type: 'leave' });
        await economyAction(client, request(), { type: 'join' });
        await expect(
            playEntertainment(client, request(), { type: 'collect' })
        ).rejects.toThrow('already used today');
    });
    it('requires template approval and limits requests while retaining stable results', async () => {
        await expect(
            playEntertainment(client, request(), {
                type: 'meme',
                template: 'plot-twist',
                caption: 'Test',
            })
        ).rejects.toThrow('not been approved');
        const r = request();
        const value = await playEntertainment(client, r, {
            type: 'dice',
            sides: 6,
        });
        expect(
            (await playEntertainment(client, r, { type: 'dice', sides: 6 }))
                .result
        ).toBe(value.result);
        await expect(
            playEntertainment(client, r, { type: 'dice', sides: 20 })
        ).rejects.toThrow('already used');
        for (let i = 0; i < 4; i++)
            await playEntertainment(client, request(), { type: 'joke' });
        await expect(
            playEntertainment(client, request(), { type: 'eightball' })
        ).rejects.toThrow('five per minute');
        expect(
            (await playEntertainment(client, r, { type: 'dice', sides: 6 })).id
        ).toBe(value.id);
    });
    it('reserves inventory once and exchanges balances/items once across concurrent acceptance', async () => {
        await buy();
        const r = request();
        const trade = await offerTrade(client, r, offer);
        expect((await offerTrade(client, r, offer)).id).toBe(trade.id);
        expect((await inventory()).quantity).toBe(0);
        const receipts = await Promise.all([
            respondTrade(client, request(buyerId), trade.id, 'accept'),
            respondTrade(client, request(buyerId), trade.id, 'accept'),
        ]);
        expect(receipts.every((r) => r.state === 'ACCEPTED')).toBe(true);
        expect((await inventory(buyerId)).quantity).toBe(1);
        expect(
            (
                await db.economyAccount.findUniqueOrThrow({
                    where: {
                        guildId_memberId: { guildId, memberId: sellerId },
                    },
                })
            ).balance
        ).toBe(110);
        expect(
            (
                await db.economyAccount.findUniqueOrThrow({
                    where: { guildId_memberId: { guildId, memberId: buyerId } },
                })
            ).balance
        ).toBe(70);
        expect(
            await db.economyEntry.count({ where: { guildId, kind: 'TRADE' } })
        ).toBe(2);
    });
    it('cannot reserve the same last item for two distinct concurrent offers', async () => {
        await buy();
        const results = await Promise.allSettled([
            offerTrade(client, request(), offer),
            offerTrade(client, request(), offer),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(
            await db.collectionTrade.count({
                where: { guildId, state: 'PENDING' },
            })
        ).toBe(1);
        expect((await inventory()).quantity).toBe(0);
    });
    it('retains escrow on a failed acceptance and returns it exactly once on decline', async () => {
        await buy();
        const trade = await offerTrade(client, request(), offer);
        await db.economyAccount.update({
            where: { guildId_memberId: { guildId, memberId: buyerId } },
            data: { balance: 0 },
        });
        await expect(
            respondTrade(client, request(buyerId), trade.id, 'accept')
        ).rejects.toThrow('balance limits');
        await expect(
            respondTrade(client, request(otherId), trade.id, 'cancel')
        ).rejects.toThrow('other members');
        await expect(
            respondTrade(
                client,
                request(sellerId, otherGuild),
                trade.id,
                'cancel'
            )
        ).rejects.toThrow();
        await respondTrade(client, request(buyerId), trade.id, 'cancel');
        await respondTrade(client, request(buyerId), trade.id, 'cancel');
        expect((await inventory()).quantity).toBe(1);
        expect(
            await db.economyEntry.count({ where: { guildId, kind: 'TRADE' } })
        ).toBe(0);
    });
    it('includes escrow in inventory limits for purchases and daily claims', async () => {
        for (const itemId of [
            'cassette',
            'ticket',
            'pin',
            'zine',
            'patch',
            'poster',
            'badge',
            'pass',
        ])
            await db.economyInventory.create({
                data: { guildId, memberId: sellerId, itemId, quantity: 99 },
            });
        const trade = await offerTrade(client, request(), {
            ...offer,
            quantity: 10,
        });
        await expect(buy()).rejects.toThrow('Inventory limit');
        await expect(
            playEntertainment(client, request(), { type: 'collect' })
        ).rejects.toThrow('full');
        await respondTrade(client, request(), trade.id, 'cancel');
        expect((await inventory()).quantity).toBe(99);
    });
    it('returns escrow when the buyer opts out even while both modules are disabled', async () => {
        await buy();
        const trade = await offerTrade(client, request(), offer);
        await moduleRegistry.configure(guildId, 'economy', false, {});
        await moduleRegistry.configure(guildId, 'entertainment', false, {});
        await economyAction(client, request(buyerId), { type: 'leave' });
        expect(
            (
                await db.collectionTrade.findUniqueOrThrow({
                    where: { id: trade.id },
                })
            ).state
        ).toBe('CANCELLED');
        expect((await inventory()).quantity).toBe(1);
    });
    it('expires abandoned offers without needing current membership or enabled modules', async () => {
        await buy();
        const trade = await offerTrade(client, request(), offer);
        await db.collectionTrade.update({
            where: { id: trade.id },
            data: { expiresAt: new Date(Date.now() - 1) },
        });
        await moduleRegistry.configure(guildId, 'entertainment', false, {});
        await maintainEntertainment();
        expect(
            (
                await db.collectionTrade.findUniqueOrThrow({
                    where: { id: trade.id },
                })
            ).state
        ).toBe('EXPIRED');
        expect((await inventory()).quantity).toBe(1);
        await maintainEntertainment();
        expect((await inventory()).quantity).toBe(1);
    });
});
