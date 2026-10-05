import { CollectionTrade, Prisma } from '@prisma/client';

export async function escrowQuantity(
    tx: Prisma.TransactionClient,
    guildId: string,
    memberId: string,
    itemId: string
) {
    return (
        (
            await tx.collectionTrade.aggregate({
                where: {
                    guildId,
                    sellerId: memberId,
                    itemId,
                    state: 'PENDING',
                },
                _sum: { quantity: true },
            })
        )._sum.quantity ?? 0
    );
}
export async function returnTrade(
    tx: Prisma.TransactionClient,
    trade: CollectionTrade,
    state: 'CANCELLED' | 'DECLINED' | 'EXPIRED'
) {
    if (trade.state !== 'PENDING') return trade;
    const key = {
        guildId: trade.guildId,
        memberId: trade.sellerId,
        itemId: trade.itemId,
    };
    const inventory = await tx.economyInventory.findUnique({
        where: { guildId_memberId_itemId: key },
    });
    if ((inventory?.quantity ?? 0) + trade.quantity > 99)
        throw new Error('Escrow inventory invariant violated');
    await tx.economyInventory.upsert({
        where: { guildId_memberId_itemId: key },
        create: { ...key, quantity: trade.quantity },
        update: { quantity: { increment: trade.quantity } },
    });
    return tx.collectionTrade.update({
        where: { id: trade.id },
        data: { state, completedAt: new Date() },
    });
}
export async function cancelMemberTrades(
    tx: Prisma.TransactionClient,
    guildId: string,
    memberId: string
) {
    const trades = await tx.collectionTrade.findMany({
        where: {
            guildId,
            state: 'PENDING',
            OR: [{ sellerId: memberId }, { buyerId: memberId }],
        },
    });
    for (const trade of trades) await returnTrade(tx, trade, 'CANCELLED');
}
