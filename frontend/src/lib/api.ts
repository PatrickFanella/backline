import axios from 'axios';

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

api.interceptors.response.use(
    (res) => res,
    async (err) => {
        if (
            err.response?.status === 401 &&
            !err.config?.url?.startsWith('/auth/')
        ) {
            const originalRequest = err.config;

            if (!originalRequest._retry) {
                originalRequest._retry = true;

                try {
                    const res = await axios.post(
                        `${config.apiUrl}/auth/refresh`,
                        {},
                        { withCredentials: true }
                    );
                    const newToken = res.data.accessToken;
                    useAuth.getState().setToken(newToken);
                    originalRequest.headers.Authorization = `Bearer ${newToken}`;
                    return api(originalRequest);
                } catch (refreshErr) {
                    // Refresh failed; logging out
                    useAuth.getState().logout();
                    return Promise.reject(refreshErr);
                }
            }
        }

        return Promise.reject(err);
    }
);

export default api;
