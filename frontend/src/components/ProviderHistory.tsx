import { useEffect, useRef, useState, type FormEvent } from 'react';

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
        [error, setError] = useState(''),
        [notice, setNotice] = useState(''),
        [busy, setBusy] = useState(false);
    const [provider, setProvider] = useState('rss'),
        [source, setSource] = useState(''),
        [channelId, setChannelId] = useState('');
    const currentGuildId = useRef(guildId);
    currentGuildId.current = guildId;
    async function load() {
        const response = await api.get<History>(
            `/guilds/${guildId}/automation/feeds`
        );
        if (currentGuildId.current === guildId) setHistory(response.data);
    }
    useEffect(() => {
        let active = true;
        setHistory(null);
        setError('');
        setNotice('');
        setBusy(false);
        setSource('');
        setChannelId('');
        api.get<History>(`/guilds/${guildId}/automation/feeds`)
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
    async function action(message: string, fn: () => Promise<unknown>) {
        const requestedGuildId = guildId;
        setBusy(true);
        setNotice('');
        setError('');
        try {
            await fn();
            if (currentGuildId.current !== requestedGuildId) return;
            await load();
            if (currentGuildId.current === requestedGuildId) setNotice(message);
        } catch {
            if (currentGuildId.current === requestedGuildId)
                setError(
                    'Provider change was not saved. Check the module, current server access and values.'
                );
        } finally {
            if (currentGuildId.current === requestedGuildId) setBusy(false);
        }
    }
    function create(event: FormEvent) {
        event.preventDefault();
        void action(
            'Feed saved. The worker will establish a baseline before sending new items.',
            () =>
                api.post(`/guilds/${guildId}/automation/feeds`, {
                    provider,
                    source,
                    channelId,
                })
        );
    }
    return (
        <section aria-label="Provider notifications" className="space-y-3">
            <p>
                Add a Twitch login, YouTube channel ID, or public HTTPS RSS/Atom
                URL. Twitch and YouTube need operator credentials. Backline
                checks the selected destination again when it delivers.
            </p>
            <p>
                The first poll records a baseline without sending older items.
                Later notifications expire after one day. RSS redirects and
                private addresses are rejected. Use /feed list and /feed remove
                to manage subscriptions.
            </p>
            <form
                onSubmit={create}
                aria-label="Add provider feed"
                className="space-y-2 border border-bl-surface rounded p-3"
            >
                <h3>Add provider feed</h3>
                <label className="bl-label">
                    Provider
                    <select
                        value={provider}
                        onChange={(e) => setProvider(e.target.value)}
                        className="bl-input"
                    >
                        <option value="rss">RSS/Atom</option>
                        <option value="youtube">YouTube</option>
                        <option value="twitch">Twitch</option>
                    </select>
                </label>
                <label className="bl-label">
                    {provider === 'rss'
                        ? 'Public HTTPS feed URL'
                        : provider === 'youtube'
                          ? 'YouTube channel ID'
                          : 'Twitch login'}
                    <input
                        required
                        value={source}
                        onChange={(e) => setSource(e.target.value)}
                        className="bl-input"
                    />
                </label>
                <label className="bl-label">
                    Destination channel ID
                    <input
                        required
                        pattern="[0-9]{17,20}"
                        value={channelId}
                        onChange={(e) => setChannelId(e.target.value)}
                        className="bl-input"
                    />
                </label>
                <button disabled={busy} type="submit">
                    Add feed
                </button>
            </form>
            {notice && (
                <p role="status" className="bl-form-notice">
                    {notice}
                </p>
            )}
            {error && (
                <p role="alert" className="bl-form-alert">
                    {error}
                </p>
            )}
            {!error && !history && (
                <p role="status" className="bl-form-notice">
                    Loading provider history…
                </p>
            )}
            {history && !history.feeds.length && (
                <p>No provider feeds are configured.</p>
            )}
            <ul>
                {history?.feeds.map((feed) => (
                    <li
                        key={feed.id}
                        className="border border-bl-surface p-3 rounded break-words"
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
                        <p className="space-x-2">
                            <button
                                disabled={busy}
                                type="button"
                                onClick={() =>
                                    void action(
                                        feed.enabled
                                            ? 'Feed paused.'
                                            : 'Feed resumed; the next worker poll establishes or continues its baseline.',
                                        () =>
                                            api.patch(
                                                `/guilds/${guildId}/automation/feeds/${feed.id}`,
                                                { enabled: !feed.enabled }
                                            )
                                    )
                                }
                            >
                                {feed.enabled ? 'Pause' : 'Resume'}
                            </button>
                            {feed.enabled && (
                                <button
                                    disabled={busy}
                                    type="button"
                                    onClick={() =>
                                        void action(
                                            'Refresh requested. The worker will poll this feed; no message is sent for older items.',
                                            () =>
                                                api.post(
                                                    `/guilds/${guildId}/automation/feeds/${feed.id}/refresh`
                                                )
                                        )
                                    }
                                >
                                    Request refresh
                                </button>
                            )}
                            <button
                                disabled={busy}
                                type="button"
                                onClick={() =>
                                    void action(
                                        'Feed removed and pending notifications cancelled.',
                                        () =>
                                            api.delete(
                                                `/guilds/${guildId}/automation/feeds/${feed.id}`
                                            )
                                    )
                                }
                            >
                                Remove
                            </button>
                        </p>
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
