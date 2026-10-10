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
export default function OnboardingConfig({
    guildId,
    enabled,
    config,
    onSaved,
    onBusy,
}: Props) {
    const [channel, setChannel] = useState(String(config.channelId ?? ''));
    const [departureChannel, setDepartureChannel] = useState(
        String(config.departureChannelId ?? '')
    );
    const [welcome, setWelcome] = useState(
        String(config.welcome ?? 'Welcome {user} to {server}!')
    );
    const [departure, setDeparture] = useState(
        String(config.departure ?? '{user} left {server}.')
    );
    const [roles, setRoles] = useState(
        Array.isArray(config.joinRoles) ? config.joinRoles.join(', ') : ''
    );
    const [requireRules, setRequireRules] = useState(
        config.requireRules === true
    );
    const [rules, setRules] = useState(String(config.rules ?? ''));
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    async function save(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        onBusy(true);
        setNotice('');
        try {
            await api.put(`/guilds/${guildId}/modules/onboarding`, {
                enabled,
                config: {
                    ...(channel ? { channelId: channel } : {}),
                    ...(departureChannel
                        ? { departureChannelId: departureChannel }
                        : {}),
                    welcome,
                    departure,
                    joinRoles: roles
                        .split(',')
                        .map((role) => role.trim())
                        .filter(Boolean),
                    requireRules,
                    rules,
                },
            });
            await onSaved();
        } catch {
            setNotice(
                'Onboarding settings were not saved. Check IDs and current Manage Roles permission if assigning roles.'
            );
        } finally {
            setBusy(false);
            onBusy(false);
        }
    }
    return (
        <form
            onSubmit={(event) => {
                void save(event);
            }}
            className="space-y-3 mt-4"
        >
            <fieldset disabled={busy} className="space-y-3">
                <legend className="bl-legend">Onboarding settings</legend>
                <label className="bl-label">
                    Welcome channel ID
                    <input
                        className="bl-input"
                        value={channel}
                        onChange={(event) => setChannel(event.target.value)}
                        pattern="[0-9]{17,20}"
                    />
                </label>
                <label className="bl-label">
                    Welcome message
                    <textarea
                        className="bl-input"
                        value={welcome}
                        onChange={(event) => setWelcome(event.target.value)}
                        maxLength={1800}
                    />
                </label>
                <p className="text-sm text-bl-muted">
                    Use {'{user}'} and {'{server}'} for the member name and
                    server name. Mentions are disabled.
                </p>
                <label className="bl-label">
                    Departure channel ID
                    <input
                        className="bl-input"
                        value={departureChannel}
                        onChange={(event) =>
                            setDepartureChannel(event.target.value)
                        }
                        pattern="[0-9]{17,20}"
                    />
                </label>
                <label className="bl-label">
                    Departure message
                    <textarea
                        className="bl-input"
                        value={departure}
                        onChange={(event) => setDeparture(event.target.value)}
                        maxLength={1800}
                    />
                </label>
                <label className="bl-label">
                    Join role IDs, separated by commas
                    <input
                        className="bl-input"
                        value={roles}
                        onChange={(event) => setRoles(event.target.value)}
                    />
                </label>
                <p className="text-sm text-bl-muted">
                    Only roles with basic chat and voice permissions can be
                    assigned. Managed roles and roles at or above the bot are
                    excluded.
                </p>
                <label className="bl-check">
                    <input
                        type="checkbox"
                        checked={requireRules}
                        onChange={(event) =>
                            setRequireRules(event.target.checked)
                        }
                    />
                    Require rules acknowledgment before assigning roles
                </label>
                <label className="bl-label">
                    Rules
                    <textarea
                        className="bl-input"
                        value={rules}
                        onChange={(event) => setRules(event.target.value)}
                        maxLength={1024}
                        required={requireRules}
                    />
                </label>
                <button
                    type="submit"
                    className="bl-button bl-button-secondary bl-button-sm"
                >
                    {busy ? 'Saving…' : 'Save onboarding settings'}
                </button>
            </fieldset>
            {notice && (
                <p role="status" className="bl-form-notice">
                    {notice}
                </p>
            )}
        </form>
    );
}
