import axios from 'axios';

import { db } from '../../../src/db';
import {
    authorizeGuild,
    canManageGuild,
    listManagedGuilds,
} from '../../../src/guilds/authorization';
import { syncGuildMemberships } from '../../../src/guilds/installations';

jest.mock('axios');
jest.mock('../../../src/guilds/installations', () => ({
    ...jest.requireActual('../../../src/guilds/installations'),
    syncGuildMemberships: jest.fn(),
}));
jest.mock('../../../src/db', () => ({
    db: {
        user: { findUnique: jest.fn(), update: jest.fn() },
        guild: { findUnique: jest.fn(), findMany: jest.fn() },
        guildInstallation: { findUnique: jest.fn() },
    },
}));

describe('server authorization', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (axios.isAxiosError as unknown as jest.Mock).mockImplementation(
            (error) => error?.isAxiosError === true
        );
        (db.guildInstallation.findUnique as jest.Mock).mockResolvedValue({
            active: true,
        });
        (db.user.findUnique as jest.Mock).mockResolvedValue({
            role: 'USER',
            accessToken: 'access',
            accessTokenExpiresAt: new Date(Date.now() + 60000),
        });
        (axios.get as jest.Mock).mockResolvedValue({
            data: [
                {
                    id: '123456789',
                    name: 'A',
                    icon: null,
                    owner: false,
                    permissions: '32',
                },
            ],
        });
        (db.guild.findUnique as jest.Mock).mockResolvedValue({
            owner: false,
            permissions: BigInt(32),
        });
    });
    it.each(['0', '16', '1024'])('denies permission mask %s', (permissions) => {
        expect(canManageGuild({ owner: false, permissions })).toBe(false);
    });
    it.each(['8', '32', '40'])('allows management mask %s', (permissions) => {
        expect(canManageGuild({ owner: false, permissions })).toBe(true);
    });
    it('allows owners', () =>
        expect(canManageGuild({ owner: true, permissions: '0' })).toBe(true));
    it('checks current Discord membership before permitting access', async () => {
        expect(await authorizeGuild('user', '123456789')).toBe(true);
        expect(syncGuildMemberships).toHaveBeenCalledWith(
            'user',
            expect.any(Array)
        );
    });
    it('denies another server and revoked membership', async () => {
        (db.guild.findUnique as jest.Mock).mockResolvedValue(null);
        expect(await authorizeGuild('user', '987654321')).toBe(false);
    });
    it('denies revoked management permission', async () => {
        (db.guild.findUnique as jest.Mock).mockResolvedValue({
            owner: false,
            permissions: BigInt(0),
        });
        expect(await authorizeGuild('user', '123456789')).toBe(false);
    });
    it('denies missing installation without calling Discord', async () => {
        (db.guildInstallation.findUnique as jest.Mock).mockResolvedValue({
            active: false,
        });
        expect(await authorizeGuild('user', '123456789')).toBe(false);
        expect(axios.get).not.toHaveBeenCalled();
    });
    it('fails closed during Discord outage', async () => {
        (axios.get as jest.Mock).mockRejectedValue(new Error('unavailable'));
        expect(await authorizeGuild('user', '123456789')).toBe(false);
    });
    it('waits for Discord rate limits and shares the retry between concurrent checks', async () => {
        jest.useFakeTimers();
        try {
            (axios.get as jest.Mock).mockRejectedValueOnce({
                isAxiosError: true,
                response: { status: 429, data: { retry_after: 1 } },
            });
            const result = Promise.all([
                authorizeGuild('user', '123456789'),
                authorizeGuild('user', '123456789'),
            ]);
            await jest.advanceTimersByTimeAsync(1049);
            expect(axios.get).toHaveBeenCalledTimes(1);
            expect(syncGuildMemberships).not.toHaveBeenCalled();
            await jest.advanceTimersByTimeAsync(1);
            expect(await result).toEqual([true, true]);
            expect(axios.get).toHaveBeenCalledTimes(2);
            expect(syncGuildMemberships).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });
    it.each([undefined, -1, 6, '1', Number.NaN])(
        'fails closed for an unusable rate-limit delay %s',
        async (retryAfter) => {
            (axios.get as jest.Mock).mockRejectedValue({
                isAxiosError: true,
                response: { status: 429, data: { retry_after: retryAfter } },
            });
            expect(await authorizeGuild('user', '123456789')).toBe(false);
            expect(axios.get).toHaveBeenCalledTimes(1);
            expect(syncGuildMemberships).not.toHaveBeenCalled();
        }
    );
    it('stops after one retry if Discord still rejects the check', async () => {
        jest.useFakeTimers();
        try {
            (axios.get as jest.Mock).mockRejectedValue({
                isAxiosError: true,
                response: { status: 429, data: { retry_after: 1 } },
            });
            const result = authorizeGuild('user', '123456789');
            await jest.advanceTimersByTimeAsync(1050);
            expect(await result).toBe(false);
            expect(axios.get).toHaveBeenCalledTimes(2);
            expect(syncGuildMemberships).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });
    it('denies banned users regardless of stale token role', async () => {
        (db.user.findUnique as jest.Mock).mockResolvedValue({ role: 'BANNED' });
        expect(await authorizeGuild('user', '123456789')).toBe(false);
    });
    it('lists only current management memberships in installed pilot servers', async () => {
        (db.guild.findMany as jest.Mock).mockResolvedValue([
            {
                guildId: '123456789',
                name: 'A',
                icon: null,
                owner: false,
                permissions: BigInt(32),
            },
            {
                guildId: '987654321',
                name: 'B',
                icon: null,
                owner: false,
                permissions: BigInt(0),
            },
            {
                guildId: '333333333',
                name: 'Outside pilot',
                icon: null,
                owner: true,
                permissions: BigInt(8),
            },
        ]);
        expect(await listManagedGuilds('user')).toEqual([
            { id: '123456789', name: 'A', icon: null },
        ]);
        expect(db.guild.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { userId: 'user', installation: { active: true } },
            })
        );
    });
    it('shares concurrent refresh token rotation', async () => {
        (db.user.findUnique as jest.Mock).mockResolvedValue({
            role: 'USER',
            accessToken: 'expired',
            refreshToken: 'refresh',
        });
        (axios.post as jest.Mock).mockResolvedValue({
            data: {
                access_token: 'new-access',
                refresh_token: 'new-refresh',
                expires_in: 3600,
                scope: 'identify guilds',
            },
        });
        expect(
            await Promise.all([
                authorizeGuild('user', '123456789'),
                authorizeGuild('user', '123456789'),
            ])
        ).toEqual([true, true]);
        expect(axios.post).toHaveBeenCalledTimes(1);
    });
});
