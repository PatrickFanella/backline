import { useEffect, useState, type FormEvent } from 'react';

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
        [cadence, setCadence] = useState('daily'),
        [days, setDays] = useState(30),
        [content, setContent] = useState('');
    async function load() {
        const response = await api.get<Series[]>(
            `/guilds/${guildId}/automation/announcements`
        );
        setSeries(response.data);
    }
    useEffect(() => {
        let active = true;
        setSeries([]);
        setError('');
        setLoading(true);
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
        setBusy(true);
        setNotice('');
        try {
            await fn();
            await load();
            setNotice(message);
        } catch {
            setError(
                'Announcement change was not saved. Check the module, current server access and schedule.'
            );
        } finally {
            setBusy(false);
        }
    }
    function create(event: FormEvent) {
        event.preventDefault();
        void action('Recurring announcement saved.', () =>
            api.post(`/guilds/${guildId}/automation/announcements`, {
                channelId,
                local,
                timeZone,
                cadence,
                days,
                content,
                disambiguation: 'earlier',
            })
        );
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
                className="space-y-2 border border-ctp-surface1 rounded p-3"
            >
                <legend>New recurring announcement</legend>
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
