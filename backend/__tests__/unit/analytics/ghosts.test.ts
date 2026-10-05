import { getGhostScores } from '../../../src/analytics/ghosts';
import { db } from '../../../src/db';
import { cache } from '../../../src/services/cache';

jest.mock('../../../src/db', () => ({ db: { $queryRaw: jest.fn() } }));
jest.mock('../../../src/services/cache', () => ({
    cache: {
        remember: jest.fn(
            (_key: string, _ttl: number, load: () => Promise<unknown>) => load()
        ),
    },
}));
describe('getGhostScores SQL boundary', () => {
    beforeEach(() => jest.clearAllMocks());
    it('serializes PostgreSQL bigint counts for the API', async () => {
        (db.$queryRaw as jest.Mock).mockResolvedValue([
            {
                userId: 'u1',
                username: 'User',
                typing_count: BigInt(10),
                message_count: BigInt(2),
                ghost_score: 10 / 3,
            },
        ]);
        const result = await getGhostScores('guild-one');
        expect(result).toEqual([
            {
                userId: 'u1',
                username: 'User',
                typingCount: 10,
                messageCount: 2,
                ghostScore: 10 / 3,
            },
        ]);
        expect(() => JSON.stringify(result)).not.toThrow();
    });
    it('binds guild and cutoff values instead of interpolating SQL text', async () => {
        (db.$queryRaw as jest.Mock).mockResolvedValue([]);
        const since = new Date('2025-01-01');
        await getGhostScores("guild'quoted", since);
        const [sql, ...values] = (db.$queryRaw as jest.Mock).mock.calls[0] as [
            TemplateStringsArray,
            ...unknown[],
        ];
        expect(sql.join('')).not.toContain("guild'quoted");
        expect(values.filter((v) => v === "guild'quoted")).toHaveLength(2);
        expect(values.filter((v) => v === since)).toHaveLength(2);
        expect(cache.remember).toHaveBeenCalledWith(
            `analytics:ghosts:guild'quoted:${since.getTime()}`,
            300,
            expect.any(Function),
            { tags: ["guild:guild'quoted", 'analytics:ghosts'] }
        );
    });
    it('returns an empty result for an empty server', async () => {
        (db.$queryRaw as jest.Mock).mockResolvedValue([]);
        expect(await getGhostScores('empty')).toEqual([]);
    });
    it('propagates database failure', async () => {
        (db.$queryRaw as jest.Mock).mockRejectedValue(
            new Error('database unavailable')
        );
        await expect(getGhostScores('guild')).rejects.toThrow(
            'database unavailable'
        );
    });
});
