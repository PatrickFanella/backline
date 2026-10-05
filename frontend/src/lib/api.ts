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
        refreshInFlight = axios
            .post(
                `${config.apiUrl}/auth/refresh`,
                {},
                { withCredentials: true }
            )
            .then((response) => {
                const token: unknown = response.data?.accessToken;
                if (typeof token !== 'string' || !token.trim()) {
                    throw new Error('Invalid refresh response');
                }
                useAuth.getState().setToken(token);
                return token;
            })
            .catch((error: unknown) => {
                useAuth.getState().logout();
                throw error;
            })
            .finally(() => {
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
