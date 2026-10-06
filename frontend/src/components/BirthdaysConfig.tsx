import { useState, type FormEvent } from 'react';

import api from '../lib/api';

export default function BirthdaysConfig({
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
    const [channel, setChannel] = useState(String(config.channelId ?? '')),
        [zone, setZone] = useState(String(config.timeZone ?? 'UTC'));
    const [hour, setHour] = useState(Number(config.hour ?? 9)),
        [leap, setLeap] = useState(String(config.leapDay ?? 'mar1'));
    const [busy, setBusy] = useState(false),
        [notice, setNotice] = useState('');
    async function save(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        onBusy(true);
        setNotice('');
        try {
            await api.put(`/guilds/${guildId}/modules/birthdays`, {
                enabled,
                config: {
                    channelId: channel.trim() || null,
                    timeZone: zone.trim(),
                    hour,
                    leapDay: leap,
                },
            });
            await onSaved();
            setNotice('Birthday settings saved.');
        } catch {
            setNotice('Birthday settings could not be saved.');
        } finally {
            setBusy(false);
            onBusy(false);
        }
    }
    const style =
        'block w-full bg-bl-panel border border-bl-border rounded p-2';
    return (
        <form onSubmit={save} className="space-y-3">
            <label className="block">
                Birthday channel ID
                <input
                    aria-label="Birthday channel ID"
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                    pattern="[0-9]{17,20}"
                    className={style}
                />
            </label>
            <label className="block">
                Birthday time zone
                <input
                    aria-label="Birthday time zone"
                    required
                    value={zone}
                    onChange={(e) => setZone(e.target.value)}
                    className={style}
                />
            </label>
            <label className="block">
                Greeting hour
                <input
                    aria-label="Greeting hour"
                    required
                    type="number"
                    min={0}
                    max={23}
                    value={hour}
                    onChange={(e) => setHour(Number(e.target.value))}
                    className={style}
                />
            </label>
            <label className="block">
                February 29 in nonleap years
                <select
                    aria-label="February 29 in nonleap years"
                    value={leap}
                    onChange={(e) => setLeap(e.target.value)}
                    className={style}
                >
                    <option value="mar1">March 1</option>
                    <option value="feb28">February 28</option>
                </select>
            </label>
            <p>
                Members choose /birthday set month day share:true to receive one
                annual greeting. Only month and day are stored. /birthday remove
                deletes their sharing data and cancels pending greetings.
                Greetings use display names without notification mentions.
            </p>
            <button disabled={busy} className="border rounded px-3 py-2">
                {busy ? 'Saving…' : 'Save birthday settings'}
            </button>
            {notice && <p role="status">{notice}</p>}
        </form>
    );
}
