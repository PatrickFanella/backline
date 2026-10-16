import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';

import { config } from '../config/env';
import { useAuth } from '../store/auth';
import { useGuild } from '../store/guild';

const api = axios.create({
    baseURL: config.apiUrl,
    withCredentials: true, // ✅ needed for refresh cookie
});

// Attach token automatically
api.interceptors.request.use((config) => {
    const token = useAuth.getState().accessToken;
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    const guildId = useGuild.getState().guildId;
    if (
        guildId &&
        /^\/(suspicion|timeline|ghosts|lurkers|heatmap|roles|clients|channels|presence|drift|shifts|messages|reaction)(\/|$)/.test(
            config.url || ''
        )
    ) {
        config.params = { ...config.params, guildId };
    }
    return config;
});

type RetryRequest = InternalAxiosRequestConfig & { _retry?: boolean };
let refreshInFlight: Promise<string> | null = null;

function refreshSession(): Promise<string> {
    if (!refreshInFlight) {
        const revision = useAuth.getState().revision;
        const refresh = () => {
            if (useAuth.getState().revision !== revision)
                return Promise.reject(new Error('Session changed'));
            return axios
                .post(
                    `${config.apiUrl}/auth/refresh`,
                    {},
                    { withCredentials: true, timeout: 10000 }
                )
                .then((response) => {
                    if (useAuth.getState().revision !== revision)
                        throw new Error('Session changed');
                    const token: unknown = response.data?.accessToken;
                    if (typeof token !== 'string' || !token.trim()) {
                        useAuth.getState().logout();
                        throw new Error('Invalid refresh response');
                    }
                    useAuth.getState().setToken(token);
                    return token;
                })
                .catch((error: unknown) => {
                    if (
                        axios.isAxiosError(error) &&
                        [400, 401].includes(error.response?.status ?? 0) &&
                        useAuth.getState().revision === revision
                    )
                        useAuth.getState().logout();
                    throw error;
                });
        };
        const serializedRefresh = async (): Promise<string> => {
            if (typeof navigator !== 'undefined' && navigator.locks)
                return await navigator.locks.request(
                    'backline-session-refresh',
                    { signal: AbortSignal.timeout(10000) },
                    refresh
                );
            return await refresh();
        };
        refreshInFlight = serializedRefresh().finally(() => {
            refreshInFlight = null;
        });
    }
    return refreshInFlight;
}

api.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
        const request = error.config as RetryRequest | undefined;
        const url = request?.url?.split('?')[0];
        const canRefresh = !url?.startsWith('/auth/') || url === '/auth/me';
        if (
            error.response?.status !== 401 ||
            !request ||
            request._retry ||
            !canRefresh
        ) {
            return Promise.reject(error);
        }
        request._retry = true;
        // A response for the old token may arrive after another request renewed it.
        const currentToken = useAuth.getState().accessToken;
        const token =
            currentToken &&
            request.headers.Authorization !== `Bearer ${currentToken}`
                ? currentToken
                : await refreshSession();
        request.headers.Authorization = `Bearer ${token}`;
        return api(request);
    }
);

export default api;
