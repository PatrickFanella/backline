import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import api from '../lib/api';

type Rule = {
    id: string;
    trigger: 'member_join' | 'provider_event' | 'manual';
    channelId: string;
    message: string;
    provider: string;
    contains: string;
    requiredRole: string | null;
    cooldownSeconds: number;
};
type Run = {
    id: string;
    ruleId: string;
    state: string;
    delivery: { state: string } | null;
};
type Props = {
    guildId: string;
    enabled: boolean;
    config: Record<string, unknown>;
    onSaved: () => Promise<void>;
    onBusy: (value: boolean) => void;
};
export default function WorkflowsConfig({
    guildId,
    enabled,
    config,
    onSaved,
    onBusy,
}: Props) {
    const [rules, setRules] = useState<Rule[]>(
            Array.isArray(config.rules) ? (config.rules as Rule[]) : []
        ),
        [busy, setBusy] = useState(false),
        [notice, setNotice] = useState(''),
        [runs, setRuns] = useState<Run[] | null>(null),
        [error, setError] = useState('');
    useEffect(() => {
        let active = true;
        api.get<Run[]>(`/guilds/${guildId}/modules/workflows/history`)
            .then((response) => {
                if (active) setRuns(response.data);
            })
            .catch(() => {
                if (active) setError('Workflow history could not be loaded.');
            });
        return () => {
            active = false;
        };
    }, [guildId]);
    function update(index: number, change: Partial<Rule>) {
        setRules((rows) =>
            rows.map((row, i) => (i === index ? { ...row, ...change } : row))
        );
    }
    async function save(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        onBusy(true);
        setNotice('');
        try {
            await api.put(`/guilds/${guildId}/modules/workflows`, {
                enabled,
                config: {
                    rules: rules.map((rule) => ({
                        id: rule.id,
                        trigger: rule.trigger,
                        channelId: rule.channelId,
                        message: rule.message,
                        provider: rule.provider,
                        contains: rule.contains,
                        requiredRole: rule.requiredRole,
                        cooldownSeconds: rule.cooldownSeconds,
                    })),
                },
            });
            await onSaved();
            setNotice(
                'Workflows saved. You are responsible for their queued actions.'
            );
        } catch {
            setNotice(
                'Workflows were not saved. Check IDs, channel IDs, substitutions and Gateway intent access.'
            );
        } finally {
            setBusy(false);
            onBusy(false);
        }
    }
    return (
        <section className="space-y-3">
            <form
                onSubmit={(event) => {
                    void save(event);
                }}
            >
                <fieldset disabled={busy} className="space-y-3">
                    <legend>Channel message workflows</legend>
                    <p>
                        Join, provider and manual triggers can send one message
                        per rule. Conditions use all selected filters. Use{' '}
                        {'{member}'}, {'{title}'} and {'{url}'} in the message.
                        Mentions cannot notify members or roles. Bot messages
                        never trigger these rules.
                    </p>
                    <p>
                        Up to ten rules; each allows fifty actions a day with a
                        cooldown. Actions expire after five minutes. Changing a
                        rule invalidates its pending work. Join triggers need
                        the Member Gateway intent. Manual triggers use /workflow
                        run id; /workflow cancel id cancels a pending run.
                    </p>
                    {rules.map((rule, index) => (
                        <fieldset
                            key={index}
                            className="space-y-2 border border-bl-border p-3 rounded"
                        >
                            <legend>Workflow {index + 1}</legend>
                            <label className="bl-label">
                                Workflow ID
                                <input
                                    required
                                    pattern="[a-z0-9-]{1,32}"
                                    value={rule.id}
                                    onChange={(event) =>
                                        update(index, {
                                            id: event.target.value,
                                        })
                                    }
                                    className="bl-input"
                                />
                            </label>
                            <label className="bl-label">
                                Trigger
                                <select
                                    value={rule.trigger}
                                    onChange={(event) =>
                                        update(index, {
                                            trigger: event.target
                                                .value as Rule['trigger'],
                                            provider: 'any',
                                            contains: '',
                                            requiredRole: null,
                                        })
                                    }
                                    className="bl-input"
                                >
                                    <option value="member_join">
                                        Member joins
                                    </option>
                                    <option value="provider_event">
                                        New provider event
                                    </option>
                                    <option value="manual">
                                        Manual command
                                    </option>
                                </select>
                            </label>
                            <label className="bl-label">
                                Destination channel ID
                                <input
                                    required
                                    pattern="[0-9]{17,20}"
                                    value={rule.channelId}
                                    onChange={(event) =>
                                        update(index, {
                                            channelId: event.target.value,
                                        })
                                    }
                                    className="bl-input"
                                />
                            </label>
                            <label className="bl-label">
                                Message
                                <textarea
                                    required
                                    maxLength={1500}
                                    value={rule.message}
                                    onChange={(event) =>
                                        update(index, {
                                            message: event.target.value,
                                        })
                                    }
                                    className="bl-input"
                                />
                            </label>
                            {rule.trigger === 'provider_event' && (
                                <>
                                    <label className="bl-label">
                                        Provider filter
                                        <select
                                            value={rule.provider}
                                            onChange={(event) =>
                                                update(index, {
                                                    provider:
                                                        event.target.value,
                                                })
                                            }
                                            className="bl-input"
                                        >
                                            <option value="any">
                                                Any provider
                                            </option>
                                            <option value="twitch">
                                                Twitch
                                            </option>
                                            <option value="youtube">
                                                YouTube
                                            </option>
                                            <option value="rss">
                                                RSS/Atom
                                            </option>
                                        </select>
                                    </label>
                                    <label className="bl-label">
                                        Title contains
                                        <input
                                            maxLength={100}
                                            value={rule.contains}
                                            onChange={(event) =>
                                                update(index, {
                                                    contains:
                                                        event.target.value,
                                                })
                                            }
                                            className="bl-input"
                                        />
                                    </label>
                                </>
                            )}
                            {rule.trigger === 'member_join' && (
                                <label className="bl-label">
                                    Required member role ID (optional)
                                    <input
                                        pattern="[0-9]{17,20}"
                                        value={rule.requiredRole ?? ''}
                                        onChange={(event) =>
                                            update(index, {
                                                requiredRole:
                                                    event.target.value || null,
                                            })
                                        }
                                        className="bl-input"
                                    />
                                </label>
                            )}
                            <label className="bl-label">
                                Cooldown seconds
                                <input
                                    required
                                    type="number"
                                    min={10}
                                    max={86400}
                                    value={rule.cooldownSeconds}
                                    onChange={(event) =>
                                        update(index, {
                                            cooldownSeconds: Number(
                                                event.target.value
                                            ),
                                        })
                                    }
                                    className="bl-input"
                                />
                            </label>
                            <button
                                type="button"
                                onClick={() =>
                                    setRules((rows) =>
                                        rows.filter((_row, i) => i !== index)
                                    )
                                }
                            >
                                Remove workflow
                            </button>
                        </fieldset>
                    ))}
                    <button
                        type="button"
                        disabled={rules.length >= 10}
                        onClick={() =>
                            setRules((rows) => [
                                ...rows,
                                {
                                    id: '',
                                    trigger: 'manual',
                                    channelId: '',
                                    message: '',
                                    provider: 'any',
                                    contains: '',
                                    requiredRole: null,
                                    cooldownSeconds: 60,
                                },
                            ])
                        }
                    >
                        Add workflow
                    </button>{' '}
                    <button type="submit">Save workflows</button>
                </fieldset>
                {notice && (
                    <p role="status" className="bl-form-notice">
                        {notice}
                    </p>
                )}
            </form>
            {error && (
                <p role="alert" className="bl-form-alert">
                    {error}
                </p>
            )}
            {!error && !runs && (
                <p role="status" className="bl-form-notice">
                    Loading workflow history…
                </p>
            )}
            {runs && !runs.length && <p>No workflow runs are recorded.</p>}
            <ul>
                {runs?.map((run) => (
                    <li
                        key={run.id}
                        className="border border-bl-surface p-3 rounded break-words"
                    >
                        {run.ruleId}: {run.state}; delivery{' '}
                        {run.delivery?.state ?? 'no job reserved'}
                        <p>Run ID: {run.id}</p>
                        {run.delivery?.state === 'RECONCILE' && (
                            <p>
                                Inspect the destination; this uncertain send is
                                held.
                            </p>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}
