import { useEffect, useState } from 'react';

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
    useEffect(() => {
        let active = true;
        setSeries([]);
        setError('');
        setLoading(true);
        api.get<Series[]>(
            `/guilds/${guildId}/modules/scheduled-utilities/series`
        )
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
    return (
        <section aria-label="Recurring announcements" className="space-y-3">
            <p>
                Use /announce series in the destination channel for daily or
                weekly announcements. Choose the first local time, time zone,
                earlier or later repeated time, and a duration of 1–365 days.
            </p>
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
                    </li>
                ))}
            </ul>
        </section>
    );
}
