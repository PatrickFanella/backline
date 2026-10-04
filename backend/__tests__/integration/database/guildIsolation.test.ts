import { randomUUID } from 'node:crypto';

import { getLurkerFlags } from '../../../src/analytics/lurkers';
import { getMultiClientLoginCounts } from '../../../src/analytics/presence';
import { db } from '../../../src/db';
import { syncGuildMemberships } from '../../../src/guilds/installations';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;

databaseTests('real PostgreSQL server isolation', () => {
    const suffix = randomUUID();
    const ids = [`admin-a-${suffix}`, `admin-b-${suffix}`];
    // Discord-shaped unique IDs without depending on server fixtures.
    const guilds = [
        String(BigInt(Date.now()) * BigInt(1000)),
        String(BigInt(Date.now()) * BigInt(1000) + BigInt(1)),
    ];
    const memberId = `member-${suffix}`;

    beforeAll(async () => {
        for (const id of ids) {
            await db.user.create({
                data: {
                    id,
                    discordId: id,
                    username: id,
                    discriminator: '0',
                    verified: true,
                    accessToken: 'fixture',
                    refreshToken: 'fixture',
                    accessTokenExpiresAt: new Date(),
                    lastSeenAt: new Date(),
                },
            });
        }
    });

    afterAll(async () => {
        await db.presenceEvent.deleteMany({ where: { userId: memberId } });
        await db.guild.deleteMany({ where: { userId: { in: ids } } });
        await db.guildInstallation.deleteMany({
            where: { guildId: { in: guilds } },
        });
        await db.user.deleteMany({ where: { id: { in: ids } } });
        await db.$disconnect();
    });

    it('supports two administrators and revokes only the departing membership', async () => {
        const payload = [
            {
                id: guilds[0],
                name: 'Fixture',
                icon: null,
                owner: true,
                permissions: '8',
            },
        ];
        await syncGuildMemberships(ids[0], payload);
        await syncGuildMemberships(ids[1], payload);
        expect(await db.guild.count({ where: { guildId: guilds[0] } })).toBe(2);
        await syncGuildMemberships(ids[0], []);
        expect(await db.guild.count({ where: { guildId: guilds[0] } })).toBe(1);
        expect(
            (await db.guild.findFirstOrThrow({ where: { guildId: guilds[0] } }))
                .userId
        ).toBe(ids[1]);
    });

    it('keeps server presence and legacy unattributed rows separate', async () => {
        await db.presenceEvent.createMany({
            data: [
                ...Array.from({ length: 5 }, () => ({
                    userId: memberId,
                    username: 'Member',
                    guildId: guilds[0],
                    clients: ['desktop', 'web'],
                })),
                {
                    userId: memberId,
                    username: 'Member',
                    guildId: guilds[1],
                    clients: ['desktop', 'web'],
                },
                {
                    userId: memberId,
                    username: 'Legacy',
                    clients: ['desktop', 'web'],
                },
            ],
        });
        const a = await getMultiClientLoginCounts(guilds[0]);
        const b = await getMultiClientLoginCounts(guilds[1]);
        expect(a.find((row) => row.userId === memberId)?.multiClientCount).toBe(
            5
        );
        expect(b.find((row) => row.userId === memberId)?.multiClientCount).toBe(
            1
        );
        expect(
            (await getLurkerFlags(guilds[0])).find(
                (row) => row.userId === memberId
            )?.lurkerScore
        ).toBe(1);
        expect(
            (await getLurkerFlags(guilds[1])).find(
                (row) => row.userId === memberId
            )?.lurkerScore
        ).toBe(0);
        expect(
            await db.presenceEvent.count({
                where: { userId: memberId, guildId: null },
            })
        ).toBe(1);
    });
});
