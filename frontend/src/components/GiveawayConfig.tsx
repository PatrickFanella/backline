import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import api from '../lib/api';

type Draw = {
    id: string;
    round: number;
    winners: string[];
    eligibleCount: number;
    announcement: string;
};
type Giveaway = {
    id: string;
    prize: string;
    state: string;
    endsAt: string;
    draws: Draw[];
    _count: { entries: number };
};
type Props = {
    guildId: string;
    enabled: boolean;
    config: Record<string, unknown>;
    onBusy: (busy: boolean) => void;
    onSaved: () => Promise<void>;
};
export default function GiveawayConfig({
    guildId,
    enabled,
    config,
    onBusy,
    onSaved,
}: Props) {
    const [history, setHistory] = useState<Giveaway[]>([]);
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const [channel, setChannel] = useState('');
    const [prize, setPrize] = useState('');
    const [minutes, setMinutes] = useState(60);
    const [winners, setWinners] = useState(1);
    const [roles, setRoles] = useState('');
    const [joinedDays, setJoinedDays] = useState(0);
    const [maxActive, setMaxActive] = useState(Number(config.maxActive ?? 10));
    const [maxEntries, setMaxEntries] = useState(
        Number(config.maxEntries ?? 500)
    );
    const [retentionDays, setRetentionDays] = useState(
        Number(config.retentionDays ?? 30)
    );
    const [jobId, setJobId] = useState<string | null>(null);
    const requestId = useRef(crypto.randomUUID());
    useEffect(() => {
        let active = true;
        api.get<Giveaway[]>(`/guilds/${guildId}/giveaways`)
            .then((response) => {
                if (active) setHistory(response.data);
            })
            .catch(() => {
                if (active) setNotice('Giveaway history is unavailable.');
            });
        return () => {
            active = false;
        };
    }, [guildId]);
    async function action(work: () => Promise<void>) {
        setBusy(true);
        onBusy(true);
        setNotice('');
        try {
            await work();
        } catch {
            setNotice(
                'The request could not be confirmed. Check your permissions and the action result before retrying.'
            );
        } finally {
            setBusy(false);
            onBusy(false);
        }
    }
    async function refresh() {
        const response = await api.get<Giveaway[]>(
            `/guilds/${guildId}/giveaways`
        );
        setHistory(response.data);
    }
    async function save(event: FormEvent) {
        event.preventDefault();
        await action(async () => {
            await api.put(`/guilds/${guildId}/modules/giveaways`, {
                enabled,
                config: { maxActive, maxEntries, retentionDays },
            });
            await onSaved();
            setNotice(
                'Giveaway limits saved. Retention applies to newly created giveaways.'
            );
        });
    }
    async function create(event: FormEvent) {
        event.preventDefault();
        await action(async () => {
            const response = await api.post<{ id: string }>(
                `/guilds/${guildId}/giveaways`,
                {
                    requestId: requestId.current,
                    channelId: channel,
                    prize,
                    winnerCount: winners,
                    requiredRoles: roles
                        .split(',')
                        .map((role) => role.trim())
                        .filter(Boolean),
                    minJoinedDays: joinedDays,
                    endsAt: new Date(
                        Date.now() + minutes * 60000
                    ).toISOString(),
                }
            );
            setJobId(response.data.id);
            setNotice(
                'Creation queued. Check the action result to confirm delivery.'
            );
        });
    }
    async function check() {
        await action(async () => {
            if (jobId) {
                const response = await api.get<{
                    state: string;
                    lastError: string | null;
                }>(`/guilds/${guildId}/jobs/${jobId}`);
                setNotice(
                    `Action: ${response.data.state}${response.data.lastError ? ` — ${response.data.lastError}` : ''}`
                );
                if (
                    ['DELIVERED', 'CANCELLED', 'FAILED'].includes(
                        response.data.state
                    )
                ) {
                    setJobId(null);
                    requestId.current = crypto.randomUUID();
                }
            }
            await refresh();
        });
    }
    const inputClass = 'block bg-bl-panel rounded p-2 w-full';
    return (
        <section className="space-y-4 mt-4">
            <form
                onSubmit={(event) => {
                    void save(event);
                }}
            >
                <fieldset disabled={busy} className="space-y-3">
                    <legend className="font-medium">Giveaway limits</legend>
                    <label className="block">
                        Active giveaways per server
                        <input
                            className={inputClass}
                            type="number"
                            min={1}
                            max={25}
                            value={maxActive}
                            onChange={(event) =>
                                setMaxActive(Number(event.target.value))
                            }
                            required
                        />
                    </label>
                    <label className="block">
                        Entries per giveaway
                        <input
                            className={inputClass}
                            type="number"
                            min={1}
                            max={1000}
                            value={maxEntries}
                            onChange={(event) =>
                                setMaxEntries(Number(event.target.value))
                            }
                            required
                        />
                    </label>
                    <label className="block">
                        Keep history after the deadline (days)
                        <input
                            className={inputClass}
                            type="number"
                            min={1}
                            max={90}
                            value={retentionDays}
                            onChange={(event) =>
                                setRetentionDays(Number(event.target.value))
                            }
                            required
                        />
                    </label>
                    <button type="submit" className="border rounded p-2">
                        Save limits
                    </button>
                </fieldset>
            </form>
            <form
                onSubmit={(event) => {
                    void create(event);
                }}
            >
                <fieldset
                    disabled={busy || !enabled || jobId !== null}
                    className="space-y-3"
                >
                    <legend className="font-medium">Create a giveaway</legend>
                    <label className="block">
                        Announcement channel ID
                        <input
                            className={inputClass}
                            pattern="[0-9]{17,20}"
                            value={channel}
                            onChange={(event) => setChannel(event.target.value)}
                            required
                        />
                    </label>
                    <label className="block">
                        Prize
                        <input
                            className={inputClass}
                            value={prize}
                            maxLength={200}
                            onChange={(event) => setPrize(event.target.value)}
                            required
                        />
                    </label>
                    <label className="block">
                        Draw in (minutes)
                        <input
                            className={inputClass}
                            type="number"
                            min={1}
                            max={43200}
                            value={minutes}
                            onChange={(event) =>
                                setMinutes(Number(event.target.value))
                            }
                            required
                        />
                    </label>
                    <label className="block">
                        Winners
                        <input
                            className={inputClass}
                            type="number"
                            min={1}
                            max={10}
                            value={winners}
                            onChange={(event) =>
                                setWinners(Number(event.target.value))
                            }
                            required
                        />
                    </label>
                    <label className="block">
                        Required role IDs (optional, comma-separated)
                        <input
                            className={inputClass}
                            value={roles}
                            onChange={(event) => setRoles(event.target.value)}
                        />
                    </label>
                    <label className="block">
                        Minimum days in this server
                        <input
                            className={inputClass}
                            type="number"
                            min={0}
                            max={365}
                            value={joinedDays}
                            onChange={(event) =>
                                setJoinedDays(Number(event.target.value))
                            }
                            required
                        />
                    </label>
                    <p className="text-sm">
                        Members enter or withdraw using the announcement
                        buttons. Current roles and membership are checked again
                        at each draw. Winners are displayed without sending
                        mention notifications.
                    </p>
                    <button type="submit" className="border rounded p-2">
                        Queue giveaway
                    </button>
                </fieldset>
            </form>
            <button
                type="button"
                disabled={busy}
                className="border rounded p-2"
                onClick={() => {
                    void check();
                }}
            >
                {jobId ? 'Check action result' : 'Refresh history'}
            </button>
            {notice && <p role="status">{notice}</p>}
            <ul className="space-y-3">
                {history.map((giveaway) => (
                    <li
                        key={giveaway.id}
                        className="border rounded p-3 space-y-2"
                    >
                        <p>
                            {giveaway.prize} — {giveaway.state};{' '}
                            {giveaway._count.entries} entries
                        </p>
                        <p className="break-all text-sm">{giveaway.id}</p>
                        {giveaway.draws.map((draw) => (
                            <p key={draw.id}>
                                Draw {draw.round}:{' '}
                                {draw.winners.join(', ') ||
                                    'No eligible entrants'}{' '}
                                · {draw.eligibleCount} eligible ·{' '}
                                {draw.announcement}
                            </p>
                        ))}
                        {(giveaway.state === 'DRAWN' ||
                            (giveaway.state === 'OPEN' &&
                                new Date(giveaway.endsAt).getTime() <=
                                    Date.now())) && (
                            <button
                                type="button"
                                className="border rounded p-2"
                                disabled={
                                    busy ||
                                    !enabled ||
                                    jobId !== null ||
                                    (giveaway.state === 'DRAWN' &&
                                        (giveaway.draws.length >= 11 ||
                                            giveaway.draws[
                                                giveaway.draws.length - 1
                                            ]?.announcement !== 'DELIVERED'))
                                }
                                onClick={() => {
                                    void action(async () => {
                                        const response = await api.post<{
                                            id: string;
                                        }>(
                                            `/guilds/${guildId}/giveaways/${giveaway.id}/${giveaway.state === 'DRAWN' ? 'reroll' : 'draw'}`,
                                            { requestId: requestId.current }
                                        );
                                        setJobId(response.data.id);
                                        setNotice(
                                            'Draw queued. Check the action result to confirm delivery. Rerolls exclude prior winners and preserve history.'
                                        );
                                    });
                                }}
                            >
                                {giveaway.state === 'DRAWN'
                                    ? 'Queue reroll'
                                    : 'Queue draw'}
                            </button>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}
