import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';

import api from '../lib/api';
import { useGuild } from '../store/guild';

type Case = {
    id: string;
    action: string;
    actorId: string;
    targetId: string | null;
    channelId: string | null;
    reason: string;
    state: string;
    detail: string | null;
    createdAt: string;
};
export default function Moderation() {
    const guildId = useGuild((state) => state.guildId);
    const [cases, setCases] = useState<Case[]>([]);
    const [action, setAction] = useState('warn');
    const [target, setTarget] = useState('');
    const [reason, setReason] = useState('');
    const [amount, setAmount] = useState(10);
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const [job, setJob] = useState<string | null>(null);
    const request = useRef<string | null>(null);
    useEffect(() => {
        let active = true;
        setCases([]);
        setJob(null);
        setNotice('');
        request.current = null;
        if (guildId)
            api.get<Case[]>(`/guilds/${guildId}/moderation/cases`)
                .then((response) => {
                    if (active) setCases(response.data);
                })
                .catch(() => {
                    if (active) setNotice('Case history is unavailable.');
                });
        return () => {
            active = false;
        };
    }, [guildId]);
    async function submit(event: FormEvent) {
        event.preventDefault();
        if (!guildId) return;
        setBusy(true);
        setNotice('');
        request.current ??= crypto.randomUUID();
        try {
            const response = await api.post<{ id: string }>(
                `/guilds/${guildId}/moderation/actions`,
                {
                    idempotencyKey: request.current,
                    action: {
                        action,
                        reason,
                        ...(action === 'purge'
                            ? { channelId: target, count: amount }
                            : { targetId: target }),
                        ...(action === 'timeout' ? { minutes: amount } : {}),
                    },
                }
            );
            setJob(response.data.id);
            setNotice(
                'Queued. Current Discord permissions will be checked before delivery.'
            );
        } catch {
            setNotice(
                'Queue response unavailable. Retry the unchanged request to check the same action.'
            );
        } finally {
            setBusy(false);
        }
    }
    async function refresh() {
        if (!guildId) return;
        setBusy(true);
        try {
            if (job) {
                const response = await api.get<{
                    state: string;
                    lastError: string | null;
                }>(`/guilds/${guildId}/jobs/${job}`);
                setNotice(
                    `Action: ${response.data.state}${response.data.lastError ? ` — ${response.data.lastError}` : ''}`
                );
                if (
                    ['DELIVERED', 'FAILED', 'CANCELLED'].includes(
                        response.data.state
                    )
                ) {
                    request.current = null;
                    setJob(null);
                }
            }
            const response = await api.get<Case[]>(
                `/guilds/${guildId}/moderation/cases`
            );
            setCases(response.data);
        } catch {
            setNotice(
                'Action status is unavailable. Delivery has not been confirmed.'
            );
        } finally {
            setBusy(false);
        }
    }
    return (
        <main
            id="main-content"
            className="min-h-screen bg-bl-canvas text-bl-ink p-6 pb-64"
        >
            <div className="max-w-4xl mx-auto space-y-6">
                <Link to="/servers" className="text-bl-accent">
                    Server setup
                </Link>
                <h1 className="text-3xl font-semibold">Moderation cases</h1>
                {!guildId ? (
                    <p>Select a server in setup first.</p>
                ) : (
                    <>
                        <p>
                            Server {guildId}. Enable Moderation in setup before
                            submitting an action. Warnings are recorded here
                            without sending a DM. Purge skips pinned messages
                            and messages older than 14 days.
                        </p>
                        <form
                            onSubmit={(event) => {
                                void submit(event);
                            }}
                            className="space-y-4"
                        >
                            <fieldset
                                disabled={
                                    busy ||
                                    job !== null ||
                                    request.current !== null
                                }
                                className="space-y-4 disabled:opacity-60"
                            >
                                <label className="block">
                                    Action
                                    <select
                                        className="block bg-bl-panel p-2"
                                        value={action}
                                        onChange={(event) =>
                                            setAction(event.target.value)
                                        }
                                    >
                                        {[
                                            'warn',
                                            'timeout',
                                            'kick',
                                            'ban',
                                            'unban',
                                            'purge',
                                        ].map((value) => (
                                            <option key={value}>{value}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="block">
                                    {action === 'purge'
                                        ? 'Channel ID'
                                        : 'Discord user ID'}
                                    <input
                                        className="block bg-bl-panel p-2 w-full"
                                        value={target}
                                        onChange={(event) =>
                                            setTarget(event.target.value)
                                        }
                                        required
                                        pattern="[0-9]{17,20}"
                                    />
                                </label>
                                {['timeout', 'purge'].includes(action) && (
                                    <label className="block">
                                        {action === 'timeout'
                                            ? 'Minutes'
                                            : 'Messages to consider'}
                                        <input
                                            className="block bg-bl-panel p-2"
                                            type="number"
                                            min={1}
                                            max={
                                                action === 'timeout'
                                                    ? 40320
                                                    : 100
                                            }
                                            value={amount}
                                            onChange={(event) =>
                                                setAmount(
                                                    Number(event.target.value)
                                                )
                                            }
                                            required
                                        />
                                    </label>
                                )}
                                <label className="block">
                                    Reason
                                    <textarea
                                        className="block bg-bl-panel p-2 w-full"
                                        value={reason}
                                        onChange={(event) =>
                                            setReason(event.target.value)
                                        }
                                        maxLength={400}
                                        required
                                    />
                                </label>
                            </fieldset>
                            <button
                                disabled={busy || job !== null}
                                type="submit"
                                className="border border-bl-border p-2 rounded disabled:opacity-50"
                            >
                                {request.current
                                    ? 'Retry same request'
                                    : 'Queue moderation action'}
                            </button>
                        </form>
                        {notice && <p role="status">{notice}</p>}
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                                void refresh();
                            }}
                            className="border border-bl-border p-2 rounded"
                        >
                            Refresh outcomes
                        </button>
                        <h2 className="text-xl font-semibold">Recent cases</h2>
                        {cases.map((record) => (
                            <article
                                key={record.id}
                                className="border border-bl-surface p-4 rounded space-y-2"
                            >
                                <p>
                                    {record.action} · {record.state} ·{' '}
                                    {new Date(
                                        record.createdAt
                                    ).toLocaleString()}
                                </p>
                                <p>Case {record.id}</p>
                                <p>
                                    Actor {record.actorId} · Target{' '}
                                    {record.targetId ?? record.channelId}
                                </p>
                                <p>{record.reason}</p>
                                {record.detail && <p>{record.detail}</p>}
                            </article>
                        ))}
                    </>
                )}
            </div>
        </main>
    );
}
