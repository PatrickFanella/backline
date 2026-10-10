import { useEffect, useState } from 'react';

import api from '../lib/api';
import { useGuild } from '../store/guild';

export type Server = { id: string; name: string; icon: string | null };

/**
 * Loads the servers the signed-in account can manage.
 * `sync` mode keeps the selected server inside that list (and clears it when the list is empty).
 * `passive` mode only fills an empty selection, so pages never lose a selection on a failed read.
 */
export function useServers(mode: 'sync' | 'passive' = 'passive') {
    const [servers, setServers] = useState<Server[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const selectGuild = useGuild((state) => state.selectGuild);
    useEffect(() => {
        let active = true;
        api.get<Server[]>('/guilds')
            .then((response) => {
                if (!active) return;
                const list = Array.isArray(response.data) ? response.data : [];
                setServers(list);
                const current = useGuild.getState().guildId;
                const known = list.some((server) => server.id === current);
                if (mode === 'sync' && !known) selectGuild(list[0]?.id ?? null);
                if (mode === 'passive' && !current && list[0])
                    selectGuild(list[0].id);
            })
            .catch(() => {
                if (active)
                    setError(
                        'Could not verify your server permissions. Sign in again or retry.'
                    );
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [mode, selectGuild]);
    return { servers, loading, error };
}
