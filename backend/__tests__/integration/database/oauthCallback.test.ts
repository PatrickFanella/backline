import axios from 'axios';
import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';

import { db } from '../../../src/db';
import authRouter from '../../../src/routes/auth';

jest.mock('axios');
const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('Discord OAuth callback and session persistence', () => {
    const discordId = 'oauth-callback-fixture';
    const guildId = '123456789';
    const app = express();
    app.use(cookieParser());
    app.use('/auth', authRouter);
    beforeEach(() => {
        jest.clearAllMocks();
        (axios.post as jest.Mock).mockResolvedValue({
            data: {
                access_token: 'fixture-access-token',
                refresh_token: 'fixture-refresh-token',
                scope: 'identify guilds',
                expires_in: 604800,
            },
        });
        (axios.get as jest.Mock).mockImplementation((url: string) => {
            if (url.endsWith('/users/@me'))
                return {
                    data: {
                        id: discordId,
                        username: 'fixture',
                        discriminator: '0',
                        avatar: null,
                    },
                };
            if (url.endsWith('/users/@me/guilds'))
                return {
                    data: [
                        {
                            id: guildId,
                            name: 'Fixture',
                            icon: null,
                            owner: true,
                            // Legacy unversioned Discord responses use numeric permissions.
                            permissions: url.includes('/api/v10/')
                                ? '9007199254740993'
                                : 8,
                        },
                    ],
                };
            throw new Error('Unexpected provider request');
        });
    });
    afterEach(async () => {
        const user = await db.user.findUnique({ where: { discordId } });
        if (user) {
            await db.guild.deleteMany({ where: { userId: user.id } });
            await db.securityLog.deleteMany({ where: { userId: user.id } });
            await db.user.delete({ where: { id: user.id } });
        }
        await db.guildInstallation.deleteMany({ where: { guildId } });
    });
    afterAll(async () => {
        await db.$disconnect();
    });
    it('completes the browser-bound callback with exact v10 permissions and a persisted session', async () => {
        const agent = request.agent(app);
        const start = await agent.get('/auth/discord/start').expect(302);
        const state = new URL(start.headers.location).searchParams.get('state');
        const result = await agent
            .get('/auth/discord')
            .query({ code: 'fixture-authorization-code', state })
            .expect(200);
        expect(result.body.accessToken).toEqual(expect.any(String));
        expect(result.headers['set-cookie']).toEqual(
            expect.arrayContaining([expect.stringContaining('refreshToken=')])
        );
        const user = await db.user.findUniqueOrThrow({ where: { discordId } });
        const membership = await db.guild.findUniqueOrThrow({
            where: { userId_guildId: { userId: user.id, guildId } },
        });
        expect(membership.permissions).toBe(BigInt('9007199254740993'));
        expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
        expect(
            await db.refreshToken.count({ where: { userId: user.id } })
        ).toBe(1);
        expect(axios.post).toHaveBeenCalledWith(
            'https://discord.com/api/v10/oauth2/token',
            expect.any(URLSearchParams),
            expect.any(Object)
        );
        await agent
            .get('/auth/discord')
            .query({ code: 'fixture-authorization-code', state })
            .expect(400);
        expect(axios.post).toHaveBeenCalledTimes(1);
        expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
    });
});
