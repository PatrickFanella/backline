import { Response } from 'express';

import { env } from './env';

export function setRefreshTokenCookie(res: Response, token: string) {
    res.cookie('refreshToken', token, {
        httpOnly: true,
        sameSite: 'lax', // ✅ use 'lax' for localhost dev
        secure: env.NODE_ENV === 'production',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
    });
}

export function clearRefreshTokenCookie(res: Response) {
    res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
    });
}
