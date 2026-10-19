import { useEffect, useState } from 'react';

import api from '../lib/api';

type Event = {
    id: string;
    kind: string;
    runAt: string;
    timeZone: string;
    state: string;
    delivery: { state: string; lastError: string | null } | null;
};
export default function ScheduledUtilitiesHistory({
    guildId,
}: {
    guildId: string;
}) {
    const [events, setEvents] = useState<Event[]>([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        let active = true;
        setLoading(true);
        setError('');
        setEvents([]);
        api.get<Event[]>(
            `/guilds/${guildId}/modules/scheduled-utilities/history`
        )
            .then((response) => {
                if (active) setEvents(response.data);
            })
            .catch(() => {
                if (active)
                    setError('Scheduled message history could not be loaded.');
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [guildId]);
    return (
        <section aria-label="Scheduled message history" className="space-y-3">
            <p>
                Use /remind create or /announce create in the destination
                Discord channel. Give a local time such as 2026-10-06T18:00 and
                a time zone such as America/Chicago. Repeated daylight-saving
                times need an explicit earlier or later choice.
            </p>
            <p>
                Messages run once within thirty days. Reminders mention their
                requester; announcements suppress notification mentions. Use the
                command’s list and cancel actions to manage pending messages.
            </p>
            {loading && (
                <p role="status" className="bl-form-notice">
                    Loading scheduled messages…
                </p>
            )}
            {error && (
                <p role="alert" className="bl-form-alert">
                    {error}
                </p>
            )}
            {!loading && !error && !events.length && (
                <p>
                    No scheduled announcements or personal reminders are
                    recorded for you.
                </p>
            )}
            <ul className="space-y-3">
                {events.map((event) => (
                    <li
                        key={event.id}
                        className="border border-bl-border/60 p-3 rounded break-words"
                    >
                        <p>
                            {event.kind === 'REMINDER'
                                ? 'Your reminder'
                                : 'Announcement'}{' '}
                            ·{' '}
                            {new Date(event.runAt).toLocaleString(undefined, {
                                timeZone: event.timeZone,
                            })}{' '}
                            · {event.timeZone}
                        </p>
                        <p>
                            Schedule: {event.state}; delivery:{' '}
                            {event.delivery?.state ?? 'No job receipt'}
                        </p>
                        <p className="text-sm break-all">ID: {event.id}</p>
                        {event.delivery?.state === 'RECONCILE' && (
                            <p className="text-bl-warning">
                                Delivery is uncertain. Investigate the
                                destination before creating another message;
                                Backline will hold this send.
                            </p>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}
