import { useState, type FormEvent } from 'react';

import api from '../lib/api';

export default function SuggestionsConfig({
    guildId,
    enabled,
    config,
    onSaved,
    onBusy,
}: {
    guildId: string;
    enabled: boolean;
    config: Record<string, unknown>;
    onSaved: () => Promise<void>;
    onBusy: (value: boolean) => void;
}) {
    const [channel, setChannel] = useState(String(config.channelId ?? ''));
    const [busy, setBusy] = useState(false),
        [notice, setNotice] = useState('');
    async function save(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        onBusy(true);
        setNotice('');
        try {
            await api.put(`/guilds/${guildId}/modules/suggestions`, {
                enabled,
                config: { channelId: channel.trim() || null },
            });
            await onSaved();
            setNotice('Suggestion settings saved.');
        } catch {
            setNotice('Suggestion settings could not be saved.');
        } finally {
            setBusy(false);
            onBusy(false);
        }
    }
    return (
        <form onSubmit={save} className="space-y-3">
            <label className="bl-label">
                Suggestion channel ID
                <input
                    aria-label="Suggestion channel ID"
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                    pattern="[0-9]{17,20}"
                    className="bl-input"
                />
            </label>
            <p>
                Members use /suggest create to submit an idea, then the
                channel’s buttons to support or oppose it. One vote per member
                can be changed while the idea is open. /suggest view shows
                current totals; managers use /suggest review to accept or
                decline with a reason.
            </p>
            <p>
                Ten submissions per member per day; one thousand retained ideas
                per server. Completed records expire after thirty days.
                Uncertain delivery stays held for investigation.
            </p>
            <button
                disabled={busy}
                className="bl-button bl-button-secondary bl-button-sm"
            >
                {busy ? 'Saving…' : 'Save suggestion settings'}
            </button>
            {notice && (
                <p role="status" className="bl-form-notice">
                    {notice}
                </p>
            )}
        </form>
    );
}
