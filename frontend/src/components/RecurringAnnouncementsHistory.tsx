import { useEffect, useRef, useState, type FormEvent } from 'react';

import api from '../lib/api';

type Series = {
    id: string;
    state: string;
    cadence: string;
    localTime: string;
    timeZone: string;
    endsAt: string;
};
export default function RecurringAnnouncementsHistory({
    guildId,
}: {
    guildId: string;
}) {
    const [series, setSeries] = useState<Series[]>([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false),
        [notice, setNotice] = useState('');
    const [channelId, setChannelId] = useState(''),
        [local, setLocal] = useState(''),
        [timeZone, setTimeZone] = useState('UTC'),
        [ambiguity, setAmbiguity] = useState<'earlier' | 'later'>('earlier'),
        [cadence, setCadence] = useState('daily'),
        [days, setDays] = useState(30),
        [content, setContent] = useState('');
    const createRequest = useRef({
        fingerprint: '',
        requestId: crypto.randomUUID(),
    });
    const currentGuildId = useRef(guildId);
    currentGuildId.current = guildId;
    async function load() {
        const response = await api.get<Series[]>(
            `/guilds/${guildId}/automation/announcements`
        );
        if (currentGuildId.current === guildId) setSeries(response.data);
    }
    useEffect(() => {
        let active = true;
        setSeries([]);
        setError('');
        setLoading(true);
        setNotice('');
        setBusy(false);
        setChannelId('');
        setLocal('');
        setContent('');
        createRequest.current = {
            fingerprint: '',
            requestId: crypto.randomUUID(),
        };
        api.get<Series[]>(`/guilds/${guildId}/automation/announcements`)
            .then((response) => {
                if (active) setSeries(response.data);
            })
            .catch(() => {
                if (active)
                    setError('Recurring announcements could not be loaded.');
            })
            .finally(() => {
                if (active) setLoading(false);
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
                    'Announcement change was not saved. Check the module, current server access and schedule.'
                );
        } finally {
            if (currentGuildId.current === requestedGuildId) setBusy(false);
        }
    }
    function create(event: FormEvent) {
        event.preventDefault();
        const payload = {
            channelId,
            local,
            timeZone,
            cadence,
            days,
            content,
            disambiguation: ambiguity,
        };
        const fingerprint = JSON.stringify(payload);
        if (
            createRequest.current.fingerprint &&
            createRequest.current.fingerprint !== fingerprint
        )
            createRequest.current = {
                fingerprint,
                requestId: crypto.randomUUID(),
            };
        else createRequest.current.fingerprint = fingerprint;
        const submission = createRequest.current;
        void action('Recurring announcement saved.', async () => {
            await api.post(`/guilds/${guildId}/automation/announcements`, {
                ...payload,
                requestId: submission.requestId,
            });
            if (
                createRequest.current === submission &&
                currentGuildId.current === guildId
            )
                createRequest.current = {
                    fingerprint: '',
                    requestId: crypto.randomUUID(),
                };
        });
    }
    return (
        <section aria-label="Recurring announcements" className="space-y-3">
            <p>
                Create daily or weekly announcements here. Choose the first
                local time, time zone, earlier or later repeated time, and a
                duration of 1–365 days.
            </p>
            <form
                onSubmit={create}
                aria-label="New recurring announcement"
                className="space-y-2 border border-ctp-surface1 rounded p-3"
            >
                <h3>New recurring announcement</h3>
                <label className="block">
                    Destination channel ID
                    <input
                        required
                        pattern="[0-9]{17,20}"
                        value={channelId}
                        onChange={(e) => setChannelId(e.target.value)}
                        className="block w-full"
                    />
                </label>
                <label className="block">
                    First local time
                    <input
                        required
                        type="datetime-local"
                        value={local}
                        onChange={(e) => setLocal(e.target.value)}
                        className="block w-full"
                    />
                </label>
                <label className="block">
                    Time zone
                    <input
                        required
                        value={timeZone}
                        onChange={(e) => setTimeZone(e.target.value)}
                        className="block w-full"
                    />
                </label>
                <label className="block">
                    Repeated local time
                    <select
                        value={ambiguity}
                        onChange={(e) =>
                            setAmbiguity(
                                e.target.value === 'later' ? 'later' : 'earlier'
                            )
                        }
                        className="block w-full"
                    >
                        <option value="earlier">Earlier occurrence</option>
                        <option value="later">Later occurrence</option>
                    </select>
                </label>
                <label className="block">
                    Cadence
                    <select
                        value={cadence}
                        onChange={(e) => setCadence(e.target.value)}
                        className="block w-full"
                    >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                    </select>
                </label>
                <label className="block">
                    Run for days
                    <input
                        required
                        type="number"
                        min={1}
                        max={365}
                        value={days}
                        onChange={(e) => setDays(Number(e.target.value))}
                        className="block w-full"
                    />
                </label>
                <label className="block">
                    Message
                    <textarea
                        required
                        maxLength={1800}
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        className="block w-full"
                    />
                </label>
                <button disabled={busy} type="submit">
                    Save recurring announcement
                </button>
            </form>
            {notice && <p role="status">{notice}</p>}
            <p>
                Missing local times are skipped. Old occurrences are skipped
                after a day. An uncertain delivery holds the series. Use
                /announce series-list and /announce series-cancel to inspect or
                cancel it.
            </p>
            {loading && <p role="status">Loading recurring announcements…</p>}
            {error && <p role="alert">{error}</p>}
            {!loading && !error && !series.length && (
                <p>No recurring announcements are recorded.</p>
            )}
            <ul className="space-y-3">
                {series.map((row) => (
                    <li
                        key={row.id}
                        className="border border-ctp-surface1 p-3 rounded break-words"
                    >
                        <p>
                            {row.cadence} · {row.state} · next {row.localTime}{' '}
                            {row.timeZone}
                        </p>
                        <p>Ends {new Date(row.endsAt).toLocaleString()}</p>
                        <p className="text-sm break-all">Series ID: {row.id}</p>
                        {row.state === 'HELD' && (
                            <p>
                                Inspect the previous delivery before creating
                                another series. Backline will hold future
                                occurrences.
                            </p>
                        )}
                        <p className="space-x-2">
                            <button
                                disabled={busy}
                                type="button"
                                onClick={() =>
                                    void action(
                                        row.state === 'PAUSED'
                                            ? 'Announcement resumed.'
                                            : 'Announcement paused; pending sends were cancelled.',
                                        () =>
                                            api.patch(
                                                `/guilds/${guildId}/automation/announcements/${row.id}`,
                                                {
                                                    action:
                                                        row.state === 'PAUSED'
                                                            ? 'resume'
                                                            : 'pause',
                                                }
                                            )
                                    )
                                }
                            >
                                {row.state === 'PAUSED' ? 'Resume' : 'Pause'}
                            </button>
                            <button
                                disabled={busy}
                                type="button"
                                onClick={() =>
                                    void action(
                                        'Announcement deleted and pending sends cancelled.',
                                        () =>
                                            api.delete(
                                                `/guilds/${guildId}/automation/announcements/${row.id}`
                                            )
                                    )
                                }
                            >
                                Delete
                            </button>
                        </p>
                    </li>
                ))}
            </ul>
        </section>
    );
}
