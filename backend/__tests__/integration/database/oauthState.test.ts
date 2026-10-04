import { Request, Response } from 'express';

import { db } from '../../../src/db';
import { beginOAuth, consumeOAuthState } from '../../../src/utils/oauthState';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('PostgreSQL OAuth nonce consumption', () => {
    afterAll(async () => {
        await db.oAuthState.deleteMany();
        await db.$disconnect();
    });
    async function start() {
        const res = { cookie: jest.fn(), clearCookie: jest.fn() };
        const url = new URL(await beginOAuth(res as unknown as Response));
        return {
            state: url.searchParams.get('state'),
            browser: res.cookie.mock.calls[0][1],
            res,
        };
    }
    it('binds to the browser and consumes once under concurrency', async () => {
        const { state, browser, res } = await start();
        const request = (cookie: string) =>
            ({
                query: { state },
                cookies: { oauthBrowser: cookie },
            }) as unknown as Request;
        expect(
            await consumeOAuthState(
                request('0'.repeat(64)),
                res as unknown as Response
            )
        ).toBe(false);
        const results = await Promise.all(
            Array.from({ length: 5 }, () =>
                consumeOAuthState(request(browser), res as unknown as Response)
            )
        );
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(
            await consumeOAuthState(
                request(browser),
                res as unknown as Response
            )
        ).toBe(false);
    });
    it('denies expired nonces and cleans them up at the next login', async () => {
        const { state, browser, res } = await start();
        await db.oAuthState.updateMany({ data: { expiresAt: new Date(0) } });
        expect(
            await consumeOAuthState(
                {
                    query: { state },
                    cookies: { oauthBrowser: browser },
                } as unknown as Request,
                res as unknown as Response
            )
        ).toBe(false);
        await start();
        expect(
            await db.oAuthState.count({
                where: { expiresAt: { lte: new Date() } },
            })
        ).toBe(0);
    });
});
