import { useState } from 'react';
import type { FormEvent } from 'react';

import api from '../lib/api';

type Props = {
    guildId: string;
    enabled: boolean;
    config: Record<string, unknown>;
    onSaved: () => Promise<void>;
    onBusy: (value: boolean) => void;
};
const defaults = {
    messageLimit: 6,
    windowSeconds: 10,
    mentionLimit: 5,
    joinLimit: 10,
    joinWindowSeconds: 60,
    raidMinutes: 10,
    timeoutMinutes: 5,
};
export default function AntiSpamConfig({
    guildId,
    enabled,
    config,
    onSaved,
    onBusy,
}: Props) {
    const [observeOnly, setObserveOnly] = useState(
        config.observeOnly !== false
    );
    const [numbers, setNumbers] = useState({
        ...defaults,
        ...Object.fromEntries(
            Object.keys(defaults).map((key) => [
                key,
                Number(config[key] ?? defaults[key as keyof typeof defaults]),
            ])
        ),
    });
    const [words, setWords] = useState(
        Array.isArray(config.prohibitedWords)
            ? config.prohibitedWords.join(', ')
            : ''
    );
    const [domains, setDomains] = useState(
        Array.isArray(config.prohibitedDomains)
            ? config.prohibitedDomains.join(', ')
            : ''
    );
    const [roles, setRoles] = useState(
        Array.isArray(config.exemptRoles) ? config.exemptRoles.join(', ') : ''
    );
    const [channels, setChannels] = useState(
        Array.isArray(config.exemptChannels)
            ? config.exemptChannels.join(', ')
            : ''
    );
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [decisions, setDecisions] = useState<
        {
            id: string;
            mode: string;
            state: string;
            userId: string;
            reasons: string[];
            delivery?: { state: string; lastError: string | null } | null;
        }[]
    >([]);
    function list(value: string) {
        return value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }
    async function save(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        onBusy(true);
        setNotice('');
        try {
            await api.put(`/guilds/${guildId}/modules/anti-spam`, {
                enabled,
                config: {
                    ...numbers,
                    observeOnly,
                    prohibitedWords: list(words),
                    prohibitedDomains: list(domains),
                    exemptRoles: list(roles),
                    exemptChannels: list(channels),
                },
            });
            await onSaved();
        } catch {
            setNotice(
                'Settings were not saved. Check limits, IDs and current Moderate Members permission for enforcement.'
            );
        } finally {
            setBusy(false);
            onBusy(false);
        }
    }
    async function history() {
        try {
            const response = await api.get<{
                decisions: typeof decisions;
                raid: { until: string } | null;
            }>(`/guilds/${guildId}/modules/anti-spam/history`);
            setDecisions(response.data.decisions);
            setNotice(
                response.data.raid &&
                    new Date(response.data.raid.until) > new Date()
                    ? `Raid mode active until ${new Date(response.data.raid.until).toLocaleString()}`
                    : 'Raid mode is inactive.'
            );
        } catch {
            setNotice('Decision history unavailable.');
        }
    }
    return (
        <div className="space-y-3 mt-4">
            <form
                onSubmit={(event) => {
                    void save(event);
                }}
            >
                <fieldset disabled={busy} className="space-y-3">
                    <legend className="font-medium">Anti-spam policy</legend>
                    <label className="flex gap-2">
                        <input
                            type="checkbox"
                            checked={observeOnly}
                            onChange={(event) =>
                                setObserveOnly(event.target.checked)
                            }
                        />
                        Observe only; record decisions without timing out
                        members
                    </label>
                    <p className="text-sm text-bl-muted">
                        Start with observation and tune thresholds. Enforcement
                        requires the Moderation module and current bot
                        permissions. Bots, server managers and administrators
                        are exempt.
                    </p>
                    {Object.entries({
                        messageLimit: 'Message burst threshold',
                        windowSeconds: 'Message window (seconds)',
                        mentionLimit: 'Mention threshold',
                        joinLimit: 'Join burst threshold',
                        joinWindowSeconds: 'Join window (seconds)',
                        raidMinutes: 'Raid duration (minutes)',
                        timeoutMinutes: 'Timeout duration (minutes)',
                    }).map(([key, label]) => (
                        <label key={key} className="block">
                            {label}
                            <input
                                type="number"
                                className="block p-2 bg-bl-panel rounded"
                                value={numbers[key as keyof typeof numbers]}
                                onChange={(event) =>
                                    setNumbers((current) => ({
                                        ...current,
                                        [key]: Number(event.target.value),
                                    }))
                                }
                                min={
                                    key === 'windowSeconds' ||
                                    key === 'messageLimit' ||
                                    key === 'joinLimit'
                                        ? 2
                                        : key === 'joinWindowSeconds'
                                          ? 5
                                          : 1
                                }
                                max={
                                    key.includes('Seconds')
                                        ? 300
                                        : key.includes('Minutes')
                                          ? 60
                                          : 100
                                }
                                required
                            />
                        </label>
                    ))}
                    {[
                        [
                            words,
                            setWords,
                            'Prohibited text, separated by commas',
                        ],
                        [
                            domains,
                            setDomains,
                            'Prohibited domains, separated by commas',
                        ],
                        [
                            roles,
                            setRoles,
                            'Exempt role IDs, separated by commas',
                        ],
                        [
                            channels,
                            setChannels,
                            'Exempt channel IDs, separated by commas',
                        ],
                    ].map(([value, setValue, label]) => (
                        <label key={label as string} className="block">
                            {label as string}
                            <input
                                className="block w-full p-2 bg-bl-panel rounded"
                                value={value as string}
                                onChange={(event) =>
                                    (setValue as (value: string) => void)(
                                        event.target.value
                                    )
                                }
                            />
                        </label>
                    ))}
                    <button
                        type="submit"
                        className="border border-bl-border rounded p-2"
                    >
                        {busy ? 'Saving…' : 'Save anti-spam policy'}
                    </button>
                </fieldset>
            </form>
            <button
                type="button"
                onClick={() => {
                    void history();
                }}
                className="border border-bl-border rounded p-2"
            >
                Review spam decisions
            </button>
            <button
                type="button"
                onClick={() => {
                    void api
                        .delete(`/guilds/${guildId}/modules/anti-spam/raid`)
                        .then(() => setNotice('Raid mode stopped.'))
                        .catch(() =>
                            setNotice('Raid mode could not be stopped.')
                        );
                }}
                className="border border-bl-border rounded p-2 ml-2"
            >
                Stop raid mode
            </button>
            {notice && <p role="status">{notice}</p>}
            {decisions.slice(0, 20).map((decision) => (
                <p key={decision.id}>
                    {decision.userId} · {decision.reasons.join(', ')} ·{' '}
                    {decision.mode} ·{' '}
                    {decision.delivery?.state ?? decision.state}
                </p>
            ))}
        </div>
    );
}
