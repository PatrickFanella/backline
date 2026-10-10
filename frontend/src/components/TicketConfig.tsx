import { useState, type FormEvent } from 'react';

import api from '../lib/api';

type Props = {
    guildId: string;
    enabled: boolean;
    config: Record<string, unknown>;
    onBusy: (busy: boolean) => void;
    onSaved: () => Promise<void>;
};
export default function TicketConfig({
    guildId,
    enabled,
    config,
    onBusy,
    onSaved,
}: Props) {
    const [category, setCategory] = useState(String(config.categoryId ?? ''));
    const [panel, setPanel] = useState(String(config.panelChannelId ?? ''));
    const [staff, setStaff] = useState(
        Array.isArray(config.staffRoles) ? config.staffRoles.join(', ') : ''
    );
    const [retention, setRetention] = useState(
        Number(config.retentionDays ?? 7)
    );
    const [limit, setLimit] = useState(Number(config.maxOpen ?? 25));
    const [content, setContent] = useState(config.retainContent === true);
    const [busy, setBusy] = useState(false),
        [notice, setNotice] = useState('');
    async function save(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        onBusy(true);
        setNotice('');
        try {
            await api.put(`/guilds/${guildId}/modules/tickets`, {
                enabled,
                config: {
                    ...(category ? { categoryId: category } : {}),
                    ...(panel ? { panelChannelId: panel } : {}),
                    staffRoles: staff.split(/[\s,]+/).filter(Boolean),
                    retentionDays: retention,
                    maxOpen: limit,
                    retainContent: content,
                },
            });
            await onSaved();
            setNotice('Ticket settings saved.');
        } catch {
            setNotice(
                'Ticket settings were not saved. Check IDs and Manage Channels/Manage Roles permissions. Existing tickets must expire before changing staff roles.'
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
                <legend className="bl-legend">Private ticket settings</legend>
                <label className="bl-label">
                    Category ID (optional)
                    <input
                        className="bl-input"
                        pattern="[0-9]{17,20}"
                        value={category}
                        onChange={(event) => setCategory(event.target.value)}
                    />
                </label>
                <label className="bl-label">
                    Panel channel ID (optional)
                    <input
                        className="bl-input"
                        pattern="[0-9]{17,20}"
                        value={panel}
                        onChange={(event) => setPanel(event.target.value)}
                    />
                </label>
                <label className="bl-label">
                    Staff role IDs, separated by commas
                    <input
                        className="bl-input"
                        required
                        value={staff}
                        onChange={(event) => setStaff(event.target.value)}
                    />
                </label>
                <label className="bl-label">
                    Delete closed ticket channels after (days)
                    <input
                        className="bl-input-compact"
                        required
                        type="number"
                        min={1}
                        max={90}
                        value={retention}
                        onChange={(event) =>
                            setRetention(Number(event.target.value))
                        }
                    />
                </label>
                <label className="bl-label">
                    Maximum active and retained ticket channels
                    <input
                        className="bl-input-compact"
                        required
                        type="number"
                        min={1}
                        max={100}
                        value={limit}
                        onChange={(event) =>
                            setLimit(Number(event.target.value))
                        }
                    />
                </label>
                <label className="bl-check">
                    <input
                        type="checkbox"
                        checked={content}
                        onChange={(event) => setContent(event.target.checked)}
                    />
                    Include available content in requested transcripts
                </label>
                <p className="text-sm text-bl-muted">
                    Use /ticket open or publish /ticket-panel after enabling.
                    Tickets allow the opener, invited participants, configured
                    staff and server administrators. Transcripts contain at most
                    1000 messages; content requires the Message Content intent.
                    Local transcripts expire after the selected retention
                    period. Downloaded copies remain with their recipients.
                </p>
                <button
                    type="submit"
                    className="bl-button bl-button-secondary bl-button-sm"
                >
                    {busy ? 'Saving…' : 'Save ticket settings'}
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
