import { Role, SubscriptionTier } from '@prisma/client';
import express from 'express';
import request from 'supertest';

import { db } from '../../../src/db';
import { userRateLimiter } from '../../../src/middleware/rateLimiter';
import { getRateLimitsForTier } from '../../../src/utils/quotaManager';

jest.mock('../../../src/db', () => ({
    db: {
        user: {
            findUnique: jest.fn(),
        },
    },
}));

jest.mock('../../../src/utils/redis', () => ({
    getRedisClient: jest.fn(() => null),
}));

const findUser = db.user.findUnique as jest.Mock;

function createApp() {
    const app = express();
    app.set('trust proxy', true);
    app.use((req, _res, next) => {
        const userId = req.header('x-test-user-id');
        if (userId) {
            req.user = {
                userId,
                discordId: `discord-${userId}`,
                role: 'USER',
                access: true,
            };
        }
        next();
    });
    app.get('/limited', userRateLimiter, (_req, res) => res.sendStatus(204));
    return app;
}

describe('user rate limiter', () => {
    const app = createApp();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('allows 30 unauthenticated IPv4 requests and blocks the next one', async () => {
        const client = request(app);
        const ip = '198.51.100.41';

        for (let index = 0; index < 30; index++) {
            const response = await client
                .get('/limited')
                .set('X-Forwarded-For', ip);
            expect(response.status).toBe(204);
        }

        const blocked = await client.get('/limited').set('X-Forwarded-For', ip);

        expect(blocked.status).toBe(429);
        expect(blocked.text).toBe('Too many requests. Please try again later.');
        expect(blocked.headers['retry-after']).toEqual(expect.any(String));
        expect(blocked.headers['ratelimit-policy']).toContain('30;w=60');
    });

    it('shares an unauthenticated limit across IPv6 addresses in one /56', async () => {
        const client = request(app);
        const firstAddress = '2001:db8:abcd:1200::41';
        const secondAddress = '2001:db8:abcd:12ff::99';

        for (let index = 0; index < 30; index++) {
            const response = await client
                .get('/limited')
                .set('X-Forwarded-For', firstAddress);
            expect(response.status).toBe(204);
        }

        const bypassAttempt = await client
            .get('/limited')
            .set('X-Forwarded-For', secondAddress);

        expect(bypassAttempt.status).toBe(429);
        expect(bypassAttempt.headers['ratelimit-policy']).toContain('30;w=60');
    });

    it('uses account tier and role limits without sharing the unauthenticated IP bucket', async () => {
        const client = request(app);
        const ip = '198.51.100.42';
        const proUserId = 'pro-user-rate-limit';
        const adminUserId = 'admin-user-rate-limit';
        findUser.mockImplementation(({ where: { id } }) => {
            if (id === proUserId)
                return Promise.resolve({
                    subscriptionTier: SubscriptionTier.PRO,
                    role: Role.USER,
                });
            if (id === adminUserId)
                return Promise.resolve({
                    subscriptionTier: SubscriptionTier.FREE,
                    role: Role.ADMIN,
                });
            return Promise.resolve(null);
        });

        for (let index = 0; index < 30; index++) {
            const response = await client
                .get('/limited')
                .set('X-Forwarded-For', ip);
            expect(response.status).toBe(204);
        }

        const proResponse = await client
            .get('/limited')
            .set('X-Forwarded-For', ip)
            .set('X-Test-User-Id', proUserId);
        const adminResponse = await client
            .get('/limited')
            .set('X-Forwarded-For', ip)
            .set('X-Test-User-Id', adminUserId);
        const unauthenticatedAfterAuth = await client
            .get('/limited')
            .set('X-Forwarded-For', ip);

        expect(proResponse.status).toBe(204);
        expect(proResponse.headers['ratelimit-policy']).toContain(
            `${getRateLimitsForTier(SubscriptionTier.PRO).requestsPerMinute};w=60`
        );
        expect(adminResponse.status).toBe(204);
        expect(adminResponse.headers['ratelimit-policy']).toContain('200;w=60');
        expect(unauthenticatedAfterAuth.status).toBe(429);
        expect(findUser).toHaveBeenCalledWith({
            where: { id: proUserId },
            select: { subscriptionTier: true, role: true },
        });
        expect(findUser).toHaveBeenCalledWith({
            where: { id: adminUserId },
            select: { subscriptionTier: true, role: true },
        });
    });
});
