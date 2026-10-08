import { Response } from 'express';

import {
    setRefreshTokenCookie,
    clearRefreshTokenCookie,
} from '../../../src/utils/cookies';

describe('Utils - Cookies', () => {
    let mockResponse: Partial<Response>;

    beforeEach(() => {
        mockResponse = {
            cookie: jest.fn().mockReturnThis(),
            clearCookie: jest.fn().mockReturnThis(),
        };
    });

    describe('setRefreshTokenCookie', () => {
        it('should set refresh token cookie with correct options', () => {
            const token = 'test-refresh-token';

            setRefreshTokenCookie(mockResponse as Response, token);

            expect(mockResponse.cookie).toHaveBeenCalledWith(
                'refreshToken',
                token,
                expect.objectContaining({
                    httpOnly: true,
                    sameSite: 'lax',
                    path: '/',
                    maxAge: 7 * 24 * 60 * 60 * 1000,
                })
            );
        });
    });

    describe('clearRefreshTokenCookie', () => {
        it('should clear refresh token cookie', () => {
            clearRefreshTokenCookie(mockResponse as Response);

            expect(mockResponse.clearCookie).toHaveBeenCalledWith(
                'refreshToken',
                expect.any(Object)
            );
        });
    });
});
