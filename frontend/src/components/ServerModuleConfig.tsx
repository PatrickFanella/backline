import { useState } from 'react';
import type { FormEvent } from 'react';

import api from '../lib/api';

type Props = {
    guildId: string;
    moduleId: string;
    enabled: boolean;
    config: Record<string, unknown>;
    onSaved: () => Promise<void>;
    onBusy: (value: boolean) => void;
};
const events = [
    'member-join',
    'member-leave',
    'message-delete',
    'message-edit',
    'member-roles',
    'role-create',
    'role-delete',
    'moderation',
];
export default function ServerModuleConfig({
    guildId,
    moduleId,
    enabled,
    config,
    onSaved,
    onBusy,
}: Props) {
    const [channelId, setChannelId] = useState(String(config.channelId ?? ''));
    const [retention, setRetention] = useState(
        Number(config.retentionDays ?? 7)
    );
    const [retainContent, setRetainContent] = useState(
        config.retainContent === true
    );
    const [selected, setSelected] = useState<string[]>(
        Array.isArray(config.events) ? (config.events as string[]) : events
    );
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    async function save(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        onBusy(true);
        setNotice('');
        try {
            await api.put(`/guilds/${guildId}/modules/${moduleId}`, {
                enabled,
                config: {
                    channelId,
                    retentionDays: retention,
                    retainContent,
                    events: selected,
                },
            });
            await onSaved();
            setNotice('Log settings saved.');
        } catch {
            setNotice(
                'Settings were not saved. Check the channel ID and your permissions.'
            );
        } finally {
            setBusy(false);
            onBusy(false);
        }
    }
    if (moduleId !== 'audit-log') return null;
    return (
        <form
            onSubmit={(event) => {
                void save(event);
            }}
            className="space-y-3 mt-4"
        >
            <fieldset disabled={busy} className="space-y-3">
                <legend className="font-medium">Audit log settings</legend>
                <label className="block">
                    Log channel ID
                    <input
                        required
                        pattern="[0-9]{17,20}"
                        value={channelId}
                        onChange={(event) => setChannelId(event.target.value)}
                        className="block bg-ctp-surface0 p-2 rounded w-full"
                    />
                </label>
                <label className="block">
                    Keep records for (days)
                    <input
                        type="number"
                        min={1}
                        max={90}
                        required
                        value={retention}
                        onChange={(event) =>
                            setRetention(Number(event.target.value))
                        }
                        className="block bg-ctp-surface0 p-2 rounded"
                    />
                </label>
                <label className="flex gap-2">
                    <input
                        type="checkbox"
                        checked={retainContent}
                        onChange={(event) =>
                            setRetainContent(event.target.checked)
                        }
                    />
                    Include available message content
                </label>
                <p className="text-sm text-ctp-subtext0">
                    Message content requires the operator to enable Discord’s
                    Message Content intent. Turning this off removes retained
                    content from local records; messages already delivered to
                    Discord remain in the log channel.
                </p>
                <div className="grid sm:grid-cols-2 gap-2">
                    {events.map((value) => (
                        <label key={value} className="flex gap-2">
                            <input
                                type="checkbox"
                                checked={selected.includes(value)}
                                onChange={(event) =>
                                    setSelected((current) =>
                                        event.target.checked
                                            ? [...current, value]
                                            : current.filter(
                                                  (item) => item !== value
                                              )
                                    )
                                }
                            />
                            {value.replace(/-/g, ' ')}
                        </label>
                    ))}
                </div>
                <button
                    type="submit"
                    className="border border-ctp-surface2 rounded p-2"
                >
                    {busy ? 'Saving…' : 'Save log settings'}
                </button>
            </fieldset>
            {notice && <p role="status">{notice}</p>}
        </form>
    );
}
