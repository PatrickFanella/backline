import { getGhostScores } from '../../../src/analytics/ghosts';
import { getLurkerFlags } from '../../../src/analytics/lurkers';
import { db } from '../../../src/db';

jest.mock('../../../src/services/cache', () => ({
    cache: {
        remember: jest.fn(
            (_key: string, _ttl: number, load: () => Promise<unknown>) => load()
        ),
    },
}));
const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('analytics PostgreSQL contracts', () => {
    const guild = 'analytics-contract-main',
        other = 'analytics-contract-other';
    const since = new Date('2026-01-01'),
        old = new Date('2025-12-31'),
        recent = new Date('2026-01-02');
    const event = (
        userId: string,
        username: string,
        createdAt = recent,
        guildId = guild
    ) => ({
        userId,
        username,
        createdAt,
        guildId,
        channelId: 'channel',
        channel: 'channel',
    });
    afterEach(async () => {
        for (const guildId of [guild, other]) {
            await db.typingEvent.deleteMany({ where: { guildId } });
            await db.messageEvent.deleteMany({ where: { guildId } });
            await db.presenceEvent.deleteMany({ where: { guildId } });
        }
    });
    afterAll(async () => {
        await db.$disconnect();
    });
    it('aggregates renamed users once and retains the documented message-plus-one formula', async () => {
        await db.typingEvent.createMany({
            data: [
                event('ghost', 'Old name', new Date('2026-01-01T01:00:00Z')),
                event('ghost', 'New name'),
                event('ghost', 'New name'),
                event('silent', 'Silent'),
                event('ghost', 'Old activity', old),
                event('ghost', 'Other server', recent, other),
            ],
        });
        await db.messageEvent.createMany({
            data: [
                { ...event('ghost', 'New name'), content: 'one' },
                { ...event('ghost', 'Old name'), content: 'two' },
                {
                    ...event('messages-only', 'Only messages'),
                    content: 'three',
                },
            ],
        });
        const result = await getGhostScores(guild, since);
        expect(result).toHaveLength(2);
        expect(result.find((row) => row.userId === 'ghost')).toEqual({
            userId: 'ghost',
            username: 'New name',
            typingCount: 3,
            messageCount: 2,
            ghostScore: 1,
        });
        expect(result.find((row) => row.userId === 'silent')?.ghostScore).toBe(
            1
        );
    });
    it('counts renamed presence across the threshold and excludes typing or message activity in the selected server and time', async () => {
        await db.presenceEvent.createMany({
            data: [
                ...Array.from({ length: 5 }, (_, i) => ({
                    userId: 'lurker',
                    username: i < 3 ? 'Old' : 'New',
                    guildId: guild,
                    clients: ['desktop'],
                    createdAt:
                        i < 3 ? new Date('2026-01-01T01:00:00Z') : recent,
                })),
                ...['typing-active', 'message-active'].map((userId) => ({
                    userId,
                    username: userId,
                    guildId: guild,
                    clients: [],
                    createdAt: recent,
                })),
                {
                    userId: 'other-only',
                    username: 'Other',
                    guildId: other,
                    clients: [],
                    createdAt: recent,
                },
            ],
        });
        await db.typingEvent.createMany({
            data: [
                event('typing-active', 'Active'),
                event('lurker', 'Outside time', old),
                event('lurker', 'Outside server', recent, other),
            ],
        });
        await db.messageEvent.create({
            data: { ...event('message-active', 'Active'), content: 'message' },
        });
        expect(await getLurkerFlags(guild, since)).toEqual([
            {
                userId: 'lurker',
                username: 'New',
                presenceCount: 5,
                lurkerScore: 1,
            },
        ]);
    });
});
