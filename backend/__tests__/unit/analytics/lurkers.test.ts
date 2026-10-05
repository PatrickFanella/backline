import { getLurkerFlags } from '../../../src/analytics/lurkers';
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
describe('getLurkerFlags SQL boundary', () => {
    beforeEach(() => jest.clearAllMocks());
    it('serializes PostgreSQL bigint counts for the API', async () => {
        (db.$queryRaw as jest.Mock).mockResolvedValue([
            {
                userId: 'u1',
                username: 'User',
                presence_count: BigInt(5),
                activity_count: BigInt(0),
                lurker_score: 1,
            },
        ]);
        const result = await getLurkerFlags('guild-one');
        expect(result).toEqual([
            {
                userId: 'u1',
                username: 'User',
                presenceCount: 5,
                lurkerScore: 1,
            },
        ]);
        expect(() => JSON.stringify(result)).not.toThrow();
    });
    it('binds guild and cutoff values instead of interpolating SQL text', async () => {
        (db.$queryRaw as jest.Mock).mockResolvedValue([]);
        const since = new Date('2025-01-01');
        await getLurkerFlags("guild'quoted", since);
        const [sql, ...values] = (db.$queryRaw as jest.Mock).mock.calls[0] as [
            TemplateStringsArray,
            ...unknown[],
        ];
        expect(sql.join('')).not.toContain("guild'quoted");
        expect(values.filter((v) => v === "guild'quoted")).toHaveLength(3);
        expect(values.filter((v) => v === since)).toHaveLength(3);
        expect(cache.remember).toHaveBeenCalledWith(
            `analytics:lurkers:guild'quoted:${since.getTime()}`,
            300,
            expect.any(Function),
            { tags: ["guild:guild'quoted", 'analytics:lurkers'] }
        );
    });
    it('returns an empty result for an empty server', async () => {
        (db.$queryRaw as jest.Mock).mockResolvedValue([]);
        expect(await getLurkerFlags('empty')).toEqual([]);
    });
    it('propagates database failure', async () => {
        (db.$queryRaw as jest.Mock).mockRejectedValue(
            new Error('database unavailable')
        );
        await expect(getLurkerFlags('guild')).rejects.toThrow(
            'database unavailable'
        );
    });
});
