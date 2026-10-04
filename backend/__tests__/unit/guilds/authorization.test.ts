import axios from 'axios';

import { db } from '../../../src/db';
import {
    authorizeGuild,
    canManageGuild,
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
        guild: { findUnique: jest.fn() },
        guildInstallation: { findUnique: jest.fn() },
    },
}));

describe('server authorization', () => {
    beforeEach(() => {
        jest.resetAllMocks();
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
    it('denies banned users regardless of stale token role', async () => {
        (db.user.findUnique as jest.Mock).mockResolvedValue({ role: 'BANNED' });
        expect(await authorizeGuild('user', '123456789')).toBe(false);
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
