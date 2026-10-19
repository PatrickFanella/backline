import { useCallback, useEffect, useRef, useState } from 'react';

import type { ModuleRecord } from '../components/ModuleSettings';
import api from '../lib/api';

/**
 * Loads the module registry for one server and keeps saves tied to that server.
 * A generation counter discards responses that arrive after the server changes.
 */
export function useModules(guildId: string | null) {
    const [modules, setModules] = useState<ModuleRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const generation = useRef(0);
    useEffect(() => {
        const current = ++generation.current;
        setModules([]);
        setLoaded(false);
        setNotice('');
        setError('');
        if (!guildId) return;
        setLoading(true);
        api.get<ModuleRecord[]>(`/guilds/${guildId}/modules`)
            .then((response) => {
                if (current !== generation.current) return;
                setModules(Array.isArray(response.data) ? response.data : []);
                setLoaded(true);
            })
            .catch(() => {
                if (current === generation.current)
                    setError(
                        'Server access or settings are unavailable. Refresh your login and check the bot installation.'
                    );
            })
            .finally(() => {
                if (current === generation.current) setLoading(false);
            });
        return () => {
            generation.current = current + 1;
        };
    }, [guildId]);
    const reload = useCallback(
        async (message?: string) => {
            const current = generation.current;
            const response = await api.get<ModuleRecord[]>(
                `/guilds/${guildId}/modules`
            );
            if (current === generation.current) {
                setModules(response.data);
                if (message) setNotice(message);
            }
        },
        [guildId]
    );
    const toggle = useCallback(
        async (module: ModuleRecord) => {
            setBusy(module.id);
            setError('');
            setNotice('');
            try {
                await api.put(`/guilds/${guildId}/modules/${module.id}`, {
                    enabled: !module.settings.enabled,
                    config: module.settings.config,
                });
                await reload('Settings saved for this server.');
            } catch {
                setError(
                    'Settings were not saved. Check your server permissions and try again.'
                );
            } finally {
                setBusy(null);
            }
        },
        [guildId, reload]
    );
    return {
        modules,
        loading,
        loaded,
        busy,
        setBusy,
        error,
        notice,
        reload,
        toggle,
    };
}
