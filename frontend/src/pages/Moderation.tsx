import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';

import ServerSwitcher from '../components/ServerSwitcher';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { Input, Select, Textarea } from '../components/ui/Field';
import { Page, PageHeader, Section } from '../components/ui/Page';
import { Table } from '../components/ui/Table';
import { useServers } from '../hooks/useServers';
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

const actions = ['warn', 'timeout', 'kick', 'ban', 'unban', 'purge'];

function stateTone(
    state: string
): 'success' | 'warning' | 'danger' | 'neutral' {
    if (state === 'DELIVERED') return 'success';
    if (state === 'FAILED' || state === 'CANCELLED') return 'danger';
    if (state === 'RECONCILE') return 'warning';
    return 'neutral';
}

export default function Moderation() {
    const guildId = useGuild((state) => state.guildId);
    const { servers } = useServers('passive');
    const [cases, setCases] = useState<Case[]>([]);
    const [action, setAction] = useState('warn');
    const [target, setTarget] = useState('');
    const [reason, setReason] = useState('');
    const [amount, setAmount] = useState(10);
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const [job, setJob] = useState<string | null>(null);
    const request = useRef<string | null>(null);
    const serverName = servers.find((server) => server.id === guildId)?.name;
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
    const locked = busy || job !== null || request.current !== null;
    return (
        <Page narrow>
            <PageHeader
                eyebrow="Backline · Moderation"
                title="Moderation cases"
                description="Queue an action for the selected server and follow its delivery. Warnings are recorded here without sending a DM. Purge skips pinned messages and messages older than 14 days."
                actions={
                    <Link
                        to="/servers"
                        className="bl-button bl-button-secondary bl-button-sm"
                    >
                        Server setup
                    </Link>
                }
            />
            <ServerSwitcher servers={servers} disabled={locked} />
            {!guildId ? (
                <EmptyState title="Select a server first">
                    <p>
                        Choose a server in setup, then enable Moderation before
                        queuing actions.
                    </p>
                </EmptyState>
            ) : (
                <>
                    <Section
                        id="queue"
                        title="Queue an action"
                        description={`Actions apply to ${serverName ?? `server ${guildId}`}. Enable Moderation in setup before submitting.`}
                    >
                        <form
                            onSubmit={(event) => {
                                void submit(event);
                            }}
                            className="bl-card p-5 space-y-4"
                        >
                            <fieldset
                                disabled={locked}
                                className="grid gap-4 sm:grid-cols-2"
                            >
                                <Select
                                    label="Action"
                                    value={action}
                                    onChange={(event) =>
                                        setAction(event.target.value)
                                    }
                                >
                                    {actions.map((value) => (
                                        <option key={value}>{value}</option>
                                    ))}
                                </Select>
                                <Input
                                    label={
                                        action === 'purge'
                                            ? 'Channel ID'
                                            : 'Discord user ID'
                                    }
                                    value={target}
                                    onChange={(event) =>
                                        setTarget(event.target.value)
                                    }
                                    required
                                    inputMode="numeric"
                                    pattern="[0-9]{17,20}"
                                    hint="17 to 20 digits, from Discord’s Copy ID action."
                                />
                                {['timeout', 'purge'].includes(action) && (
                                    <Input
                                        label={
                                            action === 'timeout'
                                                ? 'Minutes'
                                                : 'Messages to consider'
                                        }
                                        type="number"
                                        min={1}
                                        max={action === 'timeout' ? 40320 : 100}
                                        value={amount}
                                        onChange={(event) =>
                                            setAmount(
                                                Number(event.target.value)
                                            )
                                        }
                                        required
                                    />
                                )}
                                <Textarea
                                    label="Reason"
                                    className="sm:col-span-2"
                                    value={reason}
                                    onChange={(event) =>
                                        setReason(event.target.value)
                                    }
                                    maxLength={400}
                                    required
                                    hint="Stored with the case. Up to 400 characters."
                                />
                            </fieldset>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    disabled={busy || job !== null}
                                    type="submit"
                                    className="bl-button bl-button-primary"
                                >
                                    {request.current
                                        ? 'Retry same request'
                                        : 'Queue moderation action'}
                                </button>
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => {
                                        void refresh();
                                    }}
                                    className="bl-button bl-button-secondary"
                                >
                                    Refresh outcomes
                                </button>
                            </div>
                        </form>
                        {notice && (
                            <Alert
                                tone={
                                    notice.startsWith('Queued')
                                        ? 'success'
                                        : notice.includes('unavailable')
                                          ? 'warning'
                                          : 'info'
                                }
                                role="status"
                            >
                                {notice}
                            </Alert>
                        )}
                    </Section>
                    <Section
                        id="cases"
                        title="Recent cases"
                        description="Newest first. Delivery states come from the queue, not from Discord."
                    >
                        {cases.length === 0 ? (
                            <EmptyState as="h3" title="No cases yet">
                                <p>
                                    Queued actions and their outcomes appear
                                    here.
                                </p>
                            </EmptyState>
                        ) : (
                            <Table caption="Recent moderation cases">
                                <thead>
                                    <tr>
                                        <th scope="col">Action</th>
                                        <th scope="col">State</th>
                                        <th scope="col">Target</th>
                                        <th scope="col">Reason</th>
                                        <th scope="col">When</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {cases.map((record) => (
                                        <tr key={record.id}>
                                            <td>
                                                <span className="font-semibold">
                                                    {record.action}
                                                </span>
                                                <span className="block text-xs text-bl-muted font-mono">
                                                    Case {record.id}
                                                </span>
                                            </td>
                                            <td>
                                                <Badge
                                                    tone={stateTone(
                                                        record.state
                                                    )}
                                                >
                                                    {record.state}
                                                </Badge>
                                            </td>
                                            <td className="font-mono text-xs">
                                                <span className="block">
                                                    {record.targetId ??
                                                        record.channelId}
                                                </span>
                                                <span className="block text-bl-muted">
                                                    by {record.actorId}
                                                </span>
                                            </td>
                                            <td>
                                                <span className="block">
                                                    {record.reason}
                                                </span>
                                                {record.detail && (
                                                    <span className="block text-xs text-bl-muted">
                                                        {record.detail}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="whitespace-nowrap">
                                                {new Date(
                                                    record.createdAt
                                                ).toLocaleString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Section>
                </>
            )}
        </Page>
    );
}
