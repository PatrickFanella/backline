import { useEffect, useState } from 'react';

import api from '../lib/api';

type History = {
    feeds: {
        id: string;
        provider: string;
        source: string;
        enabled: boolean;
        baselineAt: string | null;
        failures: number;
        lastError: string | null;
    }[];
    events: { id: string; state: string; delivery: { state: string } | null }[];
};
export default function ProviderHistory({ guildId }: { guildId: string }) {
    const [history, setHistory] = useState<History | null>(null),
        [error, setError] = useState('');
    useEffect(() => {
        let active = true;
        setHistory(null);
        setError('');
        api.get<History>(`/guilds/${guildId}/modules/integrations/history`)
            .then((response) => {
                if (active) setHistory(response.data);
            })
            .catch(() => {
                if (active) setError('Provider history could not be loaded.');
            });
        return () => {
            active = false;
        };
    }, [guildId]);
    return (
        <section aria-label="Provider notifications" className="space-y-3">
            <p>
                Enable this module, then use /feed add in the destination
                Discord channel. Supply a Twitch login, YouTube channel ID, or
                public HTTPS RSS/Atom URL. Twitch and YouTube need operator
                credentials.
            </p>
            <p>
                The first poll records a baseline without sending older items.
                Later notifications expire after one day. RSS redirects and
                private addresses are rejected. Use /feed list and /feed remove
                to manage subscriptions.
            </p>
            {error && <p role="alert">{error}</p>}
            {!error && !history && (
                <p role="status">Loading provider history…</p>
            )}
            {history && !history.feeds.length && (
                <p>No provider feeds are configured.</p>
            )}
            <ul>
                {history?.feeds.map((feed) => (
                    <li
                        key={feed.id}
                        className="border border-ctp-surface1 p-3 rounded break-words"
                    >
                        <p>
                            {feed.provider} ·{' '}
                            {feed.enabled ? 'enabled' : 'disabled'} ·{' '}
                            {feed.baselineAt
                                ? 'baseline established'
                                : 'awaiting baseline'}
                        </p>
                        <p>{feed.source}</p>
                        <p>ID: {feed.id}</p>
                        {feed.lastError && (
                            <p>
                                {feed.lastError} · consecutive failures:{' '}
                                {feed.failures}
                            </p>
                        )}
                    </li>
                ))}
            </ul>
            <ul>
                {history?.events.map((event) => (
                    <li key={event.id}>
                        Event {event.id}: {event.state}; delivery{' '}
                        {event.delivery?.state ?? 'no job reserved'}
                        {event.delivery?.state === 'RECONCILE' && (
                            <p>
                                Inspect the destination before recreating this
                                notification. Backline holds uncertain sends.
                            </p>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}
