import { Client, PermissionFlagsBits, PermissionsBitField } from 'discord.js';

import { db } from '../../../src/db';
import {
    economyAction,
    expireEconomyEntries,
} from '../../../src/economy/engine';
import { moduleRegistry } from '../../../src/modules/registry';
import { env } from '../../../src/utils/env';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('fictional economy', () => {
    const guildId = '777777777777777881',
        otherGuild = '777777777777777882',
        actorId = '777777777777777883',
        targetId = '777777777777777884';
    const actor = {
        id: actorId,
        user: { bot: false },
        permissions: new PermissionsBitField([PermissionFlagsBits.ManageGuild]),
    };
    const target = { ...actor, id: targetId };
    const fetchMember = jest.fn(({ user }: { user: string }) =>
        Promise.resolve(user === actorId ? actor : target)
    );
    const client = {
        guilds: {
            fetch: jest
                .fn()
                .mockResolvedValue({ members: { fetch: fetchMember } }),
        },
    } as unknown as Client;
    let sequence = 0;
    const requestId = (age = 0) =>
        (
            (BigInt(Date.now() - age - 1420070400000) << BigInt(22)) +
            BigInt(++sequence)
        ).toString();
    const request = (member = actorId, server = guildId) => ({
        guildId: server,
        actorId: member,
        requestId: requestId(),
    });
    const act = (action: unknown, member = actorId, server = guildId) =>
        economyAction(client, request(member, server), action);
    let previous: string[];
    beforeAll(() => {
        previous = [...env.BOT_GUILD_IDS];
        env.BOT_GUILD_IDS.push(guildId, otherGuild);
    });
    beforeEach(async () => {
        actor.permissions = new PermissionsBitField([
            PermissionFlagsBits.ManageGuild,
        ]);
        fetchMember.mockClear();
        for (const id of [guildId, otherGuild]) {
            await db.guildInstallation.create({
                data: { guildId: id, name: 'Economy fixture', active: true },
            });
            await moduleRegistry.configure(id, 'economy', true, {
                gamesEnabled: true,
                shopEnabled: true,
            });
        }
    });
    afterEach(async () => {
        const where = { guildId: { in: [guildId, otherGuild] } };
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
    async function funded(member = actorId) {
        await act({ type: 'join' }, member);
        return act({ type: 'daily' }, member);
    }
    const account = () =>
        db.economyAccount.findUniqueOrThrow({
            where: { guildId_memberId: { guildId, memberId: actorId } },
        });
    it('requires explicit opt-in and makes concurrent daily rewards exactly once', async () => {
        await expect(act({ type: 'daily' })).rejects.toThrow('opt in');
        await act({ type: 'join' });
        const r = request();
        const entries = await Promise.all([
            economyAction(client, r, { type: 'daily' }),
            economyAction(client, r, { type: 'daily' }),
        ]);
        expect(entries[0].id).toBe(entries[1].id);
        expect((await account()).balance).toBe(100);
        await expect(act({ type: 'daily' })).rejects.toThrow('already claimed');
        expect(
            await db.economyEntry.count({ where: { guildId, kind: 'DAILY' } })
        ).toBe(1);
    });
    it('prevents concurrent purchases from overspending and replays a purchase receipt without duplicate inventory', async () => {
        await funded();
        const r = request();
        const first = await economyAction(client, r, {
            type: 'buy',
            itemId: 'pass',
            quantity: 1,
        });
        expect(
            (
                await economyAction(client, r, {
                    type: 'buy',
                    itemId: 'pass',
                    quantity: 1,
                })
            ).id
        ).toBe(first.id);
        await expect(
            act({ type: 'buy', itemId: 'pin', quantity: 1 })
        ).rejects.toThrow('Insufficient');
        expect(
            await db.economyInventory.findMany({ where: { guildId } })
        ).toEqual([expect.objectContaining({ itemId: 'pass', quantity: 1 })]);
        await act({
            type: 'adjust',
            memberId: actorId,
            amount: 100,
            reason: 'Race fixture',
        });
        const race = await Promise.allSettled([
            act({ type: 'buy', itemId: 'pass', quantity: 1 }),
            act({ type: 'buy', itemId: 'pass', quantity: 1 }),
        ]);
        expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect((await account()).balance).toBe(0);
        expect(
            (
                await db.economyInventory.findFirstOrThrow({
                    where: { guildId, itemId: 'pass' },
                })
            ).quantity
        ).toBe(2);
    });
    it('keeps economies separate even for the same member and request ID', async () => {
        await funded();
        await expect(
            act({ type: 'daily' }, actorId, otherGuild)
        ).rejects.toThrow('opt in');
        const r = request();
        await economyAction(client, r, { type: 'join' });
        await economyAction(
            client,
            { ...r, guildId: otherGuild },
            { type: 'join' }
        );
        await act({ type: 'daily' }, actorId, otherGuild);
        await act({ type: 'buy', itemId: 'pass', quantity: 1 });
        expect((await account()).balance).toBe(0);
        expect(
            (
                await db.economyAccount.findUniqueOrThrow({
                    where: {
                        guildId_memberId: {
                            guildId: otherGuild,
                            memberId: actorId,
                        },
                    },
                })
            ).balance
        ).toBe(100);
    });
    it('persists coin outcome and enforces cooldown across concurrent games', async () => {
        await funded();
        const r = request(),
            game = { type: 'coin', side: 'heads', bet: 10 };
        const receipt = await economyAction(client, r, game);
        expect(Math.abs(receipt.delta)).toBe(10);
        expect((await economyAction(client, r, game)).id).toBe(receipt.id);
        await expect(act(game)).rejects.toThrow('ten seconds');
        await expect(
            economyAction(client, r, { ...game, side: 'tails' })
        ).rejects.toThrow('already used');
        await db.economyAccount.update({
            where: { guildId_memberId: { guildId, memberId: actorId } },
            data: { lastPlayedAt: null },
        });
        const race = await Promise.allSettled([act(game), act(game)]);
        expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect((await account()).balance).toBeGreaterThanOrEqual(80);
    });
    it('withdraws while disabled and preserves balances, inventory and daily eligibility when rejoining', async () => {
        await funded();
        await act({ type: 'buy', itemId: 'pin', quantity: 1 });
        await moduleRegistry.configure(guildId, 'economy', false, {});
        await act({ type: 'leave' });
        expect((await account()).optedIn).toBe(false);
        expect((await account()).balance).toBe(80);
        await expect(act({ type: 'daily' })).rejects.toThrow('disabled');
        await moduleRegistry.configure(guildId, 'economy', true, {
            gamesEnabled: true,
            shopEnabled: true,
        });
        await expect(
            act({ type: 'buy', itemId: 'pin', quantity: 1 })
        ).rejects.toThrow('opted out');
        await act({ type: 'join' });
        await expect(act({ type: 'daily' })).rejects.toThrow('already claimed');
        expect(
            (await db.economyInventory.findFirstOrThrow({ where: { guildId } }))
                .quantity
        ).toBe(1);
    });
    it('records manager attribution and rejects revoked authority or balance overflow/underflow', async () => {
        await funded(targetId);
        const receipt = await act({
            type: 'adjust',
            memberId: targetId,
            amount: 30,
            reason: 'Event participation',
        });
        expect(receipt).toMatchObject({
            actorId,
            memberId: targetId,
            delta: 30,
            balanceAfter: 130,
            reason: 'Event participation',
        });
        await expect(
            act({
                type: 'adjust',
                memberId: targetId,
                amount: -131,
                reason: 'Underflow',
            })
        ).rejects.toThrow('Balance');
        await expect(
            act({
                type: 'adjust',
                memberId: targetId,
                amount: 1000000,
                reason: 'Overflow',
            })
        ).rejects.toThrow('Balance');
        actor.permissions = new PermissionsBitField([]);
        await expect(
            act({
                type: 'adjust',
                memberId: targetId,
                amount: 1,
                reason: 'Revoked',
            })
        ).rejects.toThrow('Manage Server');
        expect(
            await db.economyEntry.count({ where: { guildId, kind: 'ADJUST' } })
        ).toBe(1);
    });
    it('bounds inventory and rejects expired request IDs even after receipt retention', async () => {
        await funded();
        await db.economyInventory.create({
            data: { guildId, memberId: actorId, itemId: 'pin', quantity: 99 },
        });
        await expect(
            act({ type: 'buy', itemId: 'pin', quantity: 1 })
        ).rejects.toThrow('Inventory');
        expect((await account()).balance).toBe(100);
        const old = requestId(91 * 86400000);
        await db.economyEntry.create({
            data: {
                guildId,
                memberId: actorId,
                actorId,
                requestId: old,
                kind: 'DAILY',
                fingerprint: 'old',
                delta: 100,
                balanceAfter: 100,
                reason: 'Old receipt',
                createdAt: new Date(Date.now() - 91 * 86400000),
            },
        });
        await expireEconomyEntries();
        expect(
            await db.economyEntry.findUnique({
                where: { guildId_requestId: { guildId, requestId: old } },
            })
        ).toBeNull();
        await expect(
            economyAction(
                client,
                { guildId, actorId, requestId: old },
                { type: 'daily' }
            )
        ).rejects.toThrow('expired');
    });
    it('fails closed on departed members, disabled games/shop and an unavailable installation', async () => {
        await funded();
        await moduleRegistry.configure(guildId, 'economy', true, {});
        await expect(
            act({ type: 'coin', side: 'heads', bet: 0 })
        ).rejects.toThrow('games disabled');
        await expect(
            act({ type: 'buy', itemId: 'pin', quantity: 1 })
        ).rejects.toThrow('shop disabled');
        fetchMember.mockRejectedValueOnce(new Error('Member left'));
        await expect(act({ type: 'daily' })).rejects.toThrow();
        await db.guildInstallation.update({
            where: { guildId },
            data: { active: false },
        });
        await expect(act({ type: 'leave' })).rejects.toThrow('Installation');
    });
    it('rejects stale participation changes and permits withdrawal when the ledger is full', async () => {
        await funded();
        const oldLeave = request();
        await economyAction(client, oldLeave, { type: 'leave' });
        await act({ type: 'join' });
        await expect(
            economyAction(client, oldLeave, { type: 'leave' })
        ).rejects.toThrow('newer participation');
        await db.economyEntry.deleteMany({ where: { guildId } });
        await db.$executeRaw`INSERT INTO "EconomyEntry" ("id","guildId","memberId","actorId","requestId","kind","fingerprint","delta","balanceAfter","reason") SELECT 'capacity-' || n::text, ${guildId}, ${actorId}, ${actorId}, (900000000000000000::bigint + n)::text, 'COIN', 'capacity', 0, 100, 'Capacity fixture' FROM generate_series(1,100000) n`;
        await expect(
            act({ type: 'coin', side: 'heads', bet: 0 })
        ).rejects.toThrow('capacity');
        await act({ type: 'leave' });
        expect((await account()).optedIn).toBe(false);
        expect(await db.economyEntry.count({ where: { guildId } })).toBe(
            100000
        );
    });
    it('limits new actions without blocking receipt replay or participation withdrawal', async () => {
        await funded();
        const r = request();
        const action = {
            type: 'adjust',
            memberId: actorId,
            amount: 1,
            reason: 'Rate fixture',
        };
        const original = await economyAction(client, r, action);
        for (let i = 0; i < 8; i++) await act(action);
        await expect(act(action)).rejects.toThrow('ten per minute');
        expect((await economyAction(client, r, action)).id).toBe(original.id);
        await act({ type: 'leave' });
        expect((await account()).optedIn).toBe(false);
    });
});
