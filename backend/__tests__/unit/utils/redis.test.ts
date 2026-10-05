import Redis from 'ioredis';

const mockEnv = {
    REDIS_URL: 'redis://localhost:6379' as string | undefined,
    ENABLE_REDIS_RATE_LIMITING: true,
};
const mockClient = {
    on: jest.fn().mockReturnThis(),
    scan: jest.fn(),
    del: jest.fn(),
    ping: jest.fn(),
    pipeline: jest.fn(),
};
jest.mock('ioredis', () => jest.fn(() => mockClient));
jest.mock('../../../src/utils/env', () => ({ env: mockEnv }));
let redis: typeof import('../../../src/utils/redis');
describe('Redis utility external transport contracts', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockEnv.REDIS_URL = 'redis://localhost:6379';
        mockEnv.ENABLE_REDIS_RATE_LIMITING = true;
        jest.isolateModules(() => {
            redis = jest.requireActual('../../../src/utils/redis');
        });
    });
    it('returns null without configuration', () => {
        mockEnv.REDIS_URL = undefined;
        expect(redis.getRedisClient()).toBeNull();
        expect(Redis).not.toHaveBeenCalled();
    });
    it('returns null when disabled', () => {
        mockEnv.ENABLE_REDIS_RATE_LIMITING = false;
        expect(redis.getRedisClient()).toBeNull();
    });
    it('creates and reuses one configured transport', () => {
        expect(redis.getRedisClient()).toBe(mockClient);
        expect(redis.getRedisClient()).toBe(mockClient);
        expect(Redis).toHaveBeenCalledTimes(1);
    });
    it('reports unavailable without a transport', async () => {
        mockEnv.REDIS_URL = undefined;
        expect(await redis.isRedisAvailable()).toBe(false);
    });
    it('reports ping availability and failure', async () => {
        mockClient.ping
            .mockResolvedValueOnce('PONG')
            .mockRejectedValueOnce(new Error('offline'));
        expect(await redis.isRedisAvailable()).toBe(true);
        expect(await redis.isRedisAvailable()).toBe(false);
    });
    it('returns no keys without a transport', async () => {
        mockEnv.REDIS_URL = undefined;
        expect(await redis.scanKeys('prefix:*')).toEqual([]);
    });
    it('scans all pages using SCAN rather than KEYS', async () => {
        mockClient.scan
            .mockResolvedValueOnce(['5', ['key1', 'key2']])
            .mockResolvedValueOnce(['0', ['key3']]);
        expect(await redis.scanKeys('prefix:*', 100)).toEqual([
            'key1',
            'key2',
            'key3',
        ]);
        expect(mockClient.scan).toHaveBeenNthCalledWith(
            1,
            '0',
            'MATCH',
            'prefix:*',
            'COUNT',
            100
        );
        expect(mockClient.scan).toHaveBeenNthCalledWith(
            2,
            '5',
            'MATCH',
            'prefix:*',
            'COUNT',
            100
        );
    });
    it('handles scanning errors', async () => {
        mockClient.scan.mockRejectedValueOnce(new Error('offline'));
        expect(await redis.scanKeys('*')).toEqual([]);
    });
    it('does not delete without a transport', async () => {
        mockEnv.REDIS_URL = undefined;
        expect(await redis.deleteKeysByPattern('*')).toBe(0);
    });
    it('deletes matching pages in bounded batches', async () => {
        mockClient.scan
            .mockResolvedValueOnce(['5', ['key1', 'key2']])
            .mockResolvedValueOnce(['0', ['key3']]);
        mockClient.del.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
        expect(await redis.deleteKeysByPattern('prefix:*', 100)).toBe(3);
        expect(mockClient.del).toHaveBeenNthCalledWith(1, 'key1', 'key2');
        expect(mockClient.del).toHaveBeenNthCalledWith(2, 'key3');
    });
    it('handles delete errors without false success', async () => {
        mockClient.scan.mockRejectedValueOnce(new Error('offline'));
        expect(await redis.deleteKeysByPattern('*')).toBe(0);
    });
    it('returns an empty map without a transport', async () => {
        mockEnv.REDIS_URL = undefined;
        expect((await redis.getKeyValuesByPattern('*')).size).toBe(0);
    });
    it('pipelines values and excludes failed or missing reads', async () => {
        const pipeline = {
            get: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue([
                [null, '5'],
                [new Error('failed'), null],
                [null, null],
                [null, '3'],
            ]),
        };
        mockClient.scan.mockResolvedValueOnce([
            '0',
            ['one', 'bad', 'missing', 'two'],
        ]);
        mockClient.pipeline.mockReturnValue(pipeline);
        expect(await redis.getKeyValuesByPattern('*')).toEqual(
            new Map([
                ['one', '5'],
                ['two', '3'],
            ])
        );
        expect(pipeline.get).toHaveBeenCalledTimes(4);
    });
    it('does not count without a transport', async () => {
        mockEnv.REDIS_URL = undefined;
        expect(await redis.countKeysByPattern('*')).toBe(0);
    });
    it('counts all matching pages', async () => {
        mockClient.scan
            .mockResolvedValueOnce(['5', ['one', 'two', 'three']])
            .mockResolvedValueOnce(['0', ['four', 'five']]);
        expect(await redis.countKeysByPattern('*')).toBe(5);
    });
    it('handles count errors', async () => {
        mockClient.scan.mockRejectedValueOnce(new Error('offline'));
        expect(await redis.countKeysByPattern('*')).toBe(0);
    });
});
