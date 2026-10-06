import { useState } from 'react';
import type { FormEvent } from 'react';

import api from '../lib/api';

type Counter = {
    channelId: string;
    metric: 'messages' | 'joins' | 'departures';
    days: number;
    intervalMinutes: number;
};
type Report = {
    coverage: {
        status: 'OBSERVED' | 'PARTIAL' | 'UNAVAILABLE';
        observedMinutes: number;
        expectedMinutes: number;
        note: string;
    };
    totals: {
        messages: number;
        joins: number;
        departures: number;
        activeMembers: number;
    } | null;
    days: { day: string; kind: string; count: number }[];
    channels: { channelId: string; messages: number }[];
    cohort: {
        observedJoins: number;
        observedDepartures: number;
        retentionRate: number | null;
    };
};
type Props = {
    guildId: string;
    enabled: boolean;
    config: Record<string, unknown>;
    onSaved: () => Promise<void>;
    onBusy: (busy: boolean) => void;
};
export default function CommunityReportsConfig({
    guildId,
    enabled,
    config,
    onSaved,
    onBusy,
}: Props) {
    const [retention, setRetention] = useState(
        Number(config.retentionDays ?? 30)
    );
    const [excluded, setExcluded] = useState(
        Array.isArray(config.excludedChannels)
            ? config.excludedChannels.join(', ')
            : ''
    );
    const [counters, setCounters] = useState<Counter[]>(
        Array.isArray(config.counters) ? (config.counters as Counter[]) : []
    );
    const [days, setDays] = useState(7),
        [report, setReport] = useState<Report | null>(null),
        [notice, setNotice] = useState(''),
        [busy, setBusy] = useState(false);
    async function save(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        onBusy(true);
        setNotice('');
        try {
            await api.put(`/guilds/${guildId}/modules/community-reports`, {
                enabled,
                config: {
                    retentionDays: retention,
                    excludedChannels: excluded
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean),
                    counters,
                },
            });
            await onSaved();
            setNotice('Community report settings saved.');
        } catch {
            setNotice(
                'Settings were not saved. Check IDs and limits. Channel counters require current Manage Channels permission.'
            );
        } finally {
            setBusy(false);
            onBusy(false);
        }
    }
    async function load() {
        setBusy(true);
        onBusy(true);
        setNotice('');
        setReport(null);
        try {
            const to = new Date();
            const response = await api.get<Report>(
                `/guilds/${guildId}/community-report`,
                {
                    params: {
                        from: new Date(
                            to.getTime() - days * 86400000
                        ).toISOString(),
                        to: to.toISOString(),
                    },
                }
            );
            setReport(response.data);
        } catch {
            setNotice(
                'Community report unavailable. Retry after checking server access.'
            );
        } finally {
            setBusy(false);
            onBusy(false);
        }
    }
    function update(index: number, change: Partial<Counter>) {
        setCounters((rows) =>
            rows.map((row, i) => (index === i ? { ...row, ...change } : row))
        );
    }
    return (
        <div className="space-y-3 mt-4">
            <form
                onSubmit={(event) => {
                    void save(event);
                }}
            >
                <fieldset disabled={busy} className="space-y-3">
                    <legend className="font-medium">
                        Community report settings
                    </legend>
                    <p className="text-sm text-bl-muted">
                        Collect message, join and departure counts without
                        message content. Bots and webhooks are excluded. Reports
                        show gaps in collection; permission limits can also
                        affect observations.
                    </p>
                    <label className="block">
                        Report retention (days)
                        <input
                            type="number"
                            min={1}
                            max={90}
                            required
                            value={retention}
                            onChange={(event) =>
                                setRetention(Number(event.target.value))
                            }
                            className="block p-2 bg-bl-panel rounded"
                        />
                    </label>
                    <label className="block">
                        Excluded channel IDs, separated by commas
                        <input
                            value={excluded}
                            onChange={(event) =>
                                setExcluded(event.target.value)
                            }
                            className="block w-full p-2 bg-bl-panel rounded"
                        />
                    </label>
                    <p className="text-sm text-bl-muted">
                        Counter channels are renamed to observed-messages,
                        observed-joins or observed-departures with the chosen
                        time window and count. Each channel updates at most once
                        per configured interval, with a minimum of one hour.
                    </p>
                    {counters.map((counter, index) => (
                        <div key={index} className="flex flex-wrap gap-2">
                            <label>
                                Counter channel ID
                                <input
                                    required
                                    pattern="[0-9]{17,20}"
                                    value={counter.channelId}
                                    onChange={(event) =>
                                        update(index, {
                                            channelId: event.target.value,
                                        })
                                    }
                                    className="block p-2 bg-bl-panel rounded"
                                />
                            </label>
                            <label>
                                Counter metric
                                <select
                                    value={counter.metric}
                                    onChange={(event) =>
                                        update(index, {
                                            metric: event.target
                                                .value as Counter['metric'],
                                        })
                                    }
                                    className="block p-2 bg-bl-panel rounded"
                                >
                                    <option value="messages">Messages</option>
                                    <option value="joins">Joins</option>
                                    <option value="departures">
                                        Departures
                                    </option>
                                </select>
                            </label>
                            <label>
                                Counter window (days)
                                <input
                                    type="number"
                                    min={1}
                                    max={30}
                                    required
                                    value={counter.days}
                                    onChange={(event) =>
                                        update(index, {
                                            days: Number(event.target.value),
                                        })
                                    }
                                    className="block p-2 bg-bl-panel rounded"
                                />
                            </label>
                            <label>
                                Counter interval (minutes)
                                <input
                                    type="number"
                                    min={60}
                                    max={1440}
                                    required
                                    value={counter.intervalMinutes}
                                    onChange={(event) =>
                                        update(index, {
                                            intervalMinutes: Number(
                                                event.target.value
                                            ),
                                        })
                                    }
                                    className="block p-2 bg-bl-panel rounded"
                                />
                            </label>
                            <button
                                type="button"
                                onClick={() =>
                                    setCounters((rows) =>
                                        rows.filter((_, i) => i !== index)
                                    )
                                }
                            >
                                Remove counter {index + 1}
                            </button>
                        </div>
                    ))}
                    <button
                        type="button"
                        disabled={counters.length >= 5}
                        onClick={() =>
                            setCounters((rows) => [
                                ...rows,
                                {
                                    channelId: '',
                                    metric: 'messages',
                                    days: 1,
                                    intervalMinutes: 60,
                                },
                            ])
                        }
                        className="border rounded p-2"
                    >
                        Add channel counter
                    </button>
                    <button type="submit" className="border rounded p-2 ml-2">
                        {busy ? 'Saving…' : 'Save community report settings'}
                    </button>
                </fieldset>
            </form>
            <label className="block">
                Report range (days)
                <input
                    type="number"
                    min={1}
                    max={90}
                    required
                    value={days}
                    onChange={(event) => setDays(Number(event.target.value))}
                    className="block p-2 bg-bl-panel rounded"
                />
            </label>
            <button
                type="button"
                disabled={
                    busy || !Number.isInteger(days) || days < 1 || days > 90
                }
                onClick={() => {
                    void load();
                }}
                className="border rounded p-2"
            >
                Load community report
            </button>
            {notice && <p role="status">{notice}</p>}
            {report && (
                <section aria-label="Community report" className="space-y-3">
                    <p role="status">
                        {report.coverage.status === 'UNAVAILABLE'
                            ? 'History unavailable for this range. Zero activity cannot be inferred.'
                            : report.coverage.status === 'PARTIAL'
                              ? 'Collection was partial. Totals include observed events only.'
                              : 'Collector samples cover the selected range. Totals include observed events only.'}
                    </p>
                    <p>
                        {report.coverage.observedMinutes} of{' '}
                        {report.coverage.expectedMinutes} minute samples ·{' '}
                        {report.coverage.note}
                    </p>
                    {report.totals && (
                        <dl className="grid grid-cols-2 gap-2">
                            {Object.entries(report.totals).map(
                                ([key, value]) => (
                                    <div key={key}>
                                        <dt>
                                            {key === 'activeMembers'
                                                ? 'Members who sent messages'
                                                : key}
                                        </dt>
                                        <dd>{value}</dd>
                                    </div>
                                )
                            )}
                        </dl>
                    )}
                    <p>
                        Observed join cohort: {report.cohort.observedJoins}{' '}
                        joins, {report.cohort.observedDepartures} departures.
                        Retention:{' '}
                        {report.cohort.retentionRate === null
                            ? 'unavailable'
                            : `${Math.round(report.cohort.retentionRate * 100)}% of observed joins`}
                        .
                    </p>
                    {!!report.days.length && (
                        <div className="overflow-auto">
                            <table className="w-full text-left">
                                <caption>Daily observations (UTC)</caption>
                                <thead>
                                    <tr>
                                        <th scope="col">Day</th>
                                        <th scope="col">Event</th>
                                        <th scope="col">Count</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {report.days.map((row) => (
                                        <tr key={`${row.day}:${row.kind}`}>
                                            <td>{row.day}</td>
                                            <td>{row.kind}</td>
                                            <td>{row.count}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {!!report.channels.length && (
                        <ul>
                            {report.channels.map((row) => (
                                <li key={row.channelId}>
                                    Channel {row.channelId}: {row.messages}{' '}
                                    observed messages
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            )}
        </div>
    );
}
