import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

import { requireAuth, requireAdmin } from '../../../src/middleware/auth';
import { generateAccessToken } from '../../../src/utils/auth';
import { env } from '../../../src/utils/env';

describe('Middleware - Auth', () => {
    let mockRequest: Partial<Request>;
    let mockResponse: Partial<Response>;
    let mockNext: NextFunction;

    beforeEach(() => {
        mockRequest = {
            headers: {},
        };
        mockResponse = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
        mockNext = jest.fn();
    });

    describe('requireAuth', () => {
        it('should accept valid Bearer token', () => {
            const token = generateAccessToken({
                discordId: '123',
                username: 'test',
                role: 'USER',
                access: true,
            });

            mockRequest.headers = {
                authorization: `Bearer ${token}`,
            };

            requireAuth(
                mockRequest as Request,
                mockResponse as Response,
                mockNext
            );

            expect(mockNext).toHaveBeenCalled();
            expect(mockRequest.user).toBeDefined();
            expect(mockRequest.user?.discordId).toBe('123');
        });

        it('should reject missing Authorization header', () => {
            mockRequest.headers = {};

            requireAuth(
                mockRequest as Request,
                mockResponse as Response,
                mockNext
            );

            expect(mockResponse.status).toHaveBeenCalledWith(401);
            expect(mockResponse.json).toHaveBeenCalledWith({
                error: 'Missing authorization header',
            });
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should reject malformed Authorization header', () => {
            mockRequest.headers = {
                authorization: 'InvalidFormat',
            };

            requireAuth(
                mockRequest as Request,
                mockResponse as Response,
                mockNext
            );

            expect(mockResponse.status).toHaveBeenCalledWith(401);
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should reject invalid token', () => {
            mockRequest.headers = {
                authorization: 'Bearer invalid-token',
            };

            requireAuth(
                mockRequest as Request,
                mockResponse as Response,
                mockNext
            );

            expect(mockResponse.status).toHaveBeenCalledWith(401);
            expect(mockResponse.json).toHaveBeenCalledWith({
                error: 'Invalid or expired access token',
            });
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('returns 401 for an expired token so the cookie can renew it', () => {
            const token = jwt.sign(
                { discordId: '123', role: 'USER', access: true },
                env.JWT_SECRET,
                { expiresIn: -1 }
            );
            mockRequest.headers = { authorization: `Bearer ${token}` };
            requireAuth(
                mockRequest as Request,
                mockResponse as Response,
                mockNext
            );
            expect(mockResponse.status).toHaveBeenCalledWith(401);
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('keeps a valid banned account forbidden', () => {
            const token = generateAccessToken({
                discordId: '123',
                username: 'banned',
                role: 'BANNED',
                access: true,
            });
            mockRequest.headers = { authorization: `Bearer ${token}` };
            requireAuth(
                mockRequest as Request,
                mockResponse as Response,
                mockNext
            );
            expect(mockResponse.status).toHaveBeenCalledWith(403);
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should attach user to request object', () => {
            const token = generateAccessToken({
                userId: 'user-123',
                discordId: '456',
                username: 'testuser',
                role: 'ADMIN',
                access: true,
            });

            mockRequest.headers = {
                authorization: `Bearer ${token}`,
            };

            requireAuth(
                mockRequest as Request,
                mockResponse as Response,
                mockNext
            );

            expect(mockRequest.user).toBeDefined();
            expect(mockRequest.user?.discordId).toBe('456');
            expect(mockRequest.user?.username).toBe('testuser');
            expect(mockRequest.user?.role).toBe('ADMIN');
        });
    });

    describe('requireAdmin', () => {
        it('should allow admin users', () => {
            mockRequest.user = {
                userId: 'admin-123',
                discordId: '789',
                username: 'admin',
                role: 'ADMIN',
                access: true,
            };

            requireAdmin(
                mockRequest as Request,
                mockResponse as Response,
                mockNext
            );

            expect(mockNext).toHaveBeenCalled();
            expect(mockResponse.status).not.toHaveBeenCalled();
        });

        it('should reject non-admin users', () => {
            mockRequest.user = {
                userId: 'user-123',
                discordId: '456',
                username: 'user',
                role: 'USER',
                access: true,
            };

            requireAdmin(
                mockRequest as Request,
                mockResponse as Response,
                mockNext
            );

            expect(mockResponse.status).toHaveBeenCalledWith(403);
            expect(mockResponse.json).toHaveBeenCalledWith({
                error: 'Forbidden — admin access required',
            });
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should reject moderators', () => {
            mockRequest.user = {
                userId: 'mod-123',
                discordId: '321',
                username: 'moderator',
                role: 'MODERATOR',
                access: true,
            };

            requireAdmin(
                mockRequest as Request,
                mockResponse as Response,
                mockNext
            );

            expect(mockResponse.status).toHaveBeenCalledWith(403);
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should reject when user is not set', () => {
            mockRequest.user = undefined;

            requireAdmin(
                mockRequest as Request,
                mockResponse as Response,
                mockNext
            );

            expect(mockResponse.status).toHaveBeenCalledWith(403);
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should reject banned users', () => {
            mockRequest.user = {
                userId: 'banned-123',
                discordId: '999',
                username: 'banned',
                role: 'BANNED',
                access: true,
            };

            requireAdmin(
                mockRequest as Request,
                mockResponse as Response,
                mockNext
            );

            expect(mockResponse.status).toHaveBeenCalledWith(403);
            expect(mockNext).not.toHaveBeenCalled();
        });
    });
});
