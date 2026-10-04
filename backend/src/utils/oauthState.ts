import { createHash, randomBytes } from 'crypto';

import { Request, Response } from 'express';

import { db } from '../db';

import { env } from './env';

const cookieName = 'oauthBrowser';
const lifetime = 10 * 60 * 1000;
const cookieOptions = {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
};
const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');

export async function beginOAuth(res: Response): Promise<string> {
    const state = randomBytes(32).toString('hex');
    const browser = randomBytes(32).toString('hex');
    await db.oAuthState.deleteMany({
        where: { expiresAt: { lte: new Date() } },
    });
    await db.oAuthState.create({
        data: {
            stateHash: hash(state),
            browserHash: hash(browser),
            expiresAt: new Date(Date.now() + lifetime),
        },
    });
    res.cookie(cookieName, browser, { ...cookieOptions, maxAge: lifetime });
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        redirect_uri: env.DISCORD_REDIRECT_URI,
        response_type: 'code',
        scope: 'identify guilds',
        state,
    }).toString();
    return url.toString();
}

export async function consumeOAuthState(
    req: Request,
    res: Response
): Promise<boolean> {
    const state = req.query.state;
    const browser: unknown = req.cookies?.oauthBrowser;
    res.clearCookie(cookieName, cookieOptions);
    if (
        typeof state !== 'string' ||
        !/^[a-f0-9]{64}$/.test(state) ||
        typeof browser !== 'string' ||
        !/^[a-f0-9]{64}$/.test(browser)
    )
        return false;
    const result = await db.oAuthState.deleteMany({
        where: {
            stateHash: hash(state),
            browserHash: hash(browser),
            expiresAt: { gt: new Date() },
        },
    });
    return result.count === 1;
}
