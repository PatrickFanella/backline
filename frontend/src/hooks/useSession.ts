import axios from 'axios';
import { useEffect } from 'react';

import api from '../lib/api';
import { useAuth, type Session } from '../store/auth';

let pending: { revision: number; promise: Promise<void> } | null = null;

export function loadSession(force = false): Promise<void> {
    const state = useAuth.getState();
    if (pending?.revision === state.revision) return pending.promise;
    if (!force && state.sessionStatus !== 'unknown') return Promise.resolve();
    const revision = state.revision;
    useAuth.setState({ sessionStatus: 'loading', sessionError: null });
    const promise = api
        .get<Session>('/auth/me', { timeout: 10000 })
        .then(({ data }) => {
            if (useAuth.getState().revision !== revision) return;
            useAuth.setState({
                session: data,
                sessionStatus: 'authenticated',
                sessionError: null,
            });
        })
        .catch((error: unknown) => {
            if (useAuth.getState().revision !== revision) return;
            const status = axios.isAxiosError(error)
                ? error.response?.status
                : undefined;
            if (status === 400 || status === 401) {
                useAuth.getState().logout();
            } else {
                useAuth.setState({
                    sessionStatus: 'unavailable',
                    sessionError:
                        'We could not check your session. Try again when the connection recovers.',
                });
            }
        })
        .finally(() => {
            if (pending?.promise === promise) pending = null;
        });
    pending = { revision, promise };
    return promise;
}

export function useSession(enabled = true) {
    const session = useAuth((s) => s.session);
    const status = useAuth((s) => s.sessionStatus);
    const error = useAuth((s) => s.sessionError);
    useEffect(() => {
        if (enabled) void loadSession();
    }, [enabled]);
    return {
        session,
        loading: enabled && (status === 'unknown' || status === 'loading'),
        error,
    };
}
