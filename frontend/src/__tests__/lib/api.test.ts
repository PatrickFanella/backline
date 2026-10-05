import axios, {
    AxiosError,
    type AxiosResponse,
    type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import api from '../../lib/api';
import { useAuth } from '../../store/auth';

function response(
    request: InternalAxiosRequestConfig,
    data: unknown
): AxiosResponse {
    return {
        config: request,
        data,
        status: 200,
        statusText: 'OK',
        headers: {},
    };
}
function denied(request: InternalAxiosRequestConfig, status = 401): never {
    throw new AxiosError('Denied', 'ERR_BAD_REQUEST', request, undefined, {
        config: request,
        data: {},
        status,
        statusText: 'Denied',
        headers: {},
    });
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
const originalAdapter = api.defaults.adapter;

describe('API session recovery', () => {
    beforeEach(() => {
        useAuth.setState({ accessToken: null });
    });
    afterEach(() => {
        api.defaults.adapter = originalAdapter;
        vi.restoreAllMocks();
    });

    it('recovers a cold dashboard session through the refresh cookie', async () => {
        const refresh = vi
            .spyOn(axios, 'post')
            .mockResolvedValue({ data: { accessToken: 'fresh' } });
        api.defaults.adapter = async (request) => {
            if (request.headers.Authorization !== 'Bearer fresh')
                denied(request);
            return response(request, { user: 'owner' });
        };
        expect((await api.get('/auth/me')).data).toEqual({ user: 'owner' });
        expect(refresh).toHaveBeenCalledOnce();
        expect(refresh).toHaveBeenCalledWith(
            'http://localhost:3001/api/auth/refresh',
            {},
            { withCredentials: true }
        );
        expect(useAuth.getState().accessToken).toBe('fresh');
    });

    it('shares one rotating refresh across concurrent expired requests', async () => {
        useAuth.setState({ accessToken: 'expired' });
        const gate = deferred<{ data: { accessToken: string } }>();
        const refresh = vi.spyOn(axios, 'post').mockReturnValue(gate.promise);
        api.defaults.adapter = async (request) => {
            if (request.headers.Authorization !== 'Bearer fresh')
                denied(request);
            return response(request, { ok: true });
        };
        const requests = Promise.all([api.get('/guilds'), api.get('/auth/me')]);
        await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
        gate.resolve({ data: { accessToken: 'fresh' } });
        expect(await requests).toHaveLength(2);
        expect(refresh).toHaveBeenCalledOnce();
    });

    it('reuses the new token for a late response to the old token', async () => {
        useAuth.setState({ accessToken: 'expired' });
        const late = deferred<void>();
        const refresh = vi
            .spyOn(axios, 'post')
            .mockResolvedValue({ data: { accessToken: 'fresh' } });
        api.defaults.adapter = async (request) => {
            if (request.headers.Authorization === 'Bearer fresh')
                return response(request, {});
            if (request.url === '/late') await late.promise;
            denied(request);
        };
        const old = api.get('/late');
        await api.get('/guilds');
        late.resolve();
        await old;
        expect(refresh).toHaveBeenCalledOnce();
    });

    it('keeps forbidden responses out of refresh and preserves the session', async () => {
        useAuth.setState({ accessToken: 'valid' });
        const refresh = vi.spyOn(axios, 'post');
        api.defaults.adapter = async (request) => denied(request, 403);
        await expect(api.get('/guilds')).rejects.toMatchObject({
            response: { status: 403 },
        });
        expect(refresh).not.toHaveBeenCalled();
        expect(useAuth.getState().accessToken).toBe('valid');
    });

    it('ends the session when refresh fails', async () => {
        useAuth.setState({ accessToken: 'expired' });
        vi.spyOn(axios, 'post').mockRejectedValue(new Error('Revoked cookie'));
        api.defaults.adapter = async (request) => denied(request);
        await expect(api.get('/guilds')).rejects.toThrow('Revoked cookie');
        expect(useAuth.getState().accessToken).toBeNull();
    });

    it('does not refresh OAuth and refresh endpoints recursively', async () => {
        const refresh = vi.spyOn(axios, 'post');
        api.defaults.adapter = async (request) => denied(request);
        await expect(api.post('/auth/refresh')).rejects.toMatchObject({
            response: { status: 401 },
        });
        await expect(api.get('/auth/discord')).rejects.toMatchObject({
            response: { status: 401 },
        });
        expect(refresh).not.toHaveBeenCalled();
    });

    it('does not erase a renewed session when the retried resource fails', async () => {
        vi.spyOn(axios, 'post').mockResolvedValue({
            data: { accessToken: 'fresh' },
        });
        api.defaults.adapter = async (request) =>
            denied(
                request,
                request.headers.Authorization === 'Bearer fresh' ? 503 : 401
            );
        await expect(api.get('/guilds')).rejects.toMatchObject({
            response: { status: 503 },
        });
        expect(useAuth.getState().accessToken).toBe('fresh');
    });

    it('rejects a malformed refresh response', async () => {
        vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });
        api.defaults.adapter = async (request) => denied(request);
        await expect(api.get('/guilds')).rejects.toThrow(
            'Invalid refresh response'
        );
        expect(useAuth.getState().accessToken).toBeNull();
    });
});
