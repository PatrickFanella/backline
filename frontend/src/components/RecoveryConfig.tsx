import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import api from '../lib/api';

type Snapshot = {
    id: string;
    kind: string;
    checksum: string;
    createdAt: string;
    expiresAt: string;
};
type Props = {
    guildId: string;
    enabled: boolean;
    config: Record<string, unknown>;
    onSaved: () => Promise<void>;
    onBusy: (value: boolean) => void;
};
export default function RecoveryConfig({
    guildId,
    enabled,
    config,
    onSaved,
    onBusy,
}: Props) {
    const [scheduled, setScheduled] = useState(config.scheduled === true),
        [interval, setInterval] = useState(Number(config.intervalHours ?? 24)),
        [retainDays, setRetainDays] = useState(Number(config.retainDays ?? 30)),
        [snapshots, setSnapshots] = useState<Snapshot[] | null>(null),
        [error, setError] = useState(''),
        [notice, setNotice] = useState(''),
        [busy, setBusy] = useState(false);
    const [protectedChannels, setProtectedChannels] = useState(
            Array.isArray(config.protectedChannelIds)
                ? config.protectedChannelIds.join(', ')
                : ''
        ),
        [protectedRoles, setProtectedRoles] = useState(
            Array.isArray(config.protectedRoleIds)
                ? config.protectedRoleIds.join(', ')
                : ''
        );
    const ids = (value: string) =>
        value
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean);
    useEffect(() => {
        let active = true;
        api.get<Snapshot[]>(`/guilds/${guildId}/modules/recovery/snapshots`)
            .then((response) => {
                if (active) setSnapshots(response.data);
            })
            .catch(() => {
                if (active) setError('Snapshot history could not be loaded.');
            });
        return () => {
            active = false;
        };
    }, [guildId]);
    async function save(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        onBusy(true);
        setNotice('');
        try {
            await api.put(`/guilds/${guildId}/modules/recovery`, {
                enabled,
                config: {
                    scheduled,
                    intervalHours: interval,
                    retainDays,
                    protectedChannelIds: ids(protectedChannels),
                    protectedRoleIds: ids(protectedRoles),
                },
            });
            await onSaved();
            setNotice('Snapshot settings saved.');
        } catch {
            setNotice(
                'Snapshot settings were not saved. Check interval and retention limits.'
            );
        } finally {
            setBusy(false);
            onBusy(false);
        }
    }
    async function download(snapshot: Snapshot) {
        setBusy(true);
        onBusy(true);
        try {
            const response = await api.get(
                `/guilds/${guildId}/modules/recovery/snapshots/${snapshot.id}/export`,
                { responseType: 'blob' }
            );
            const url = URL.createObjectURL(response.data);
            try {
                const link = document.createElement('a');
                link.href = url;
                link.download = `backline-${guildId}-${snapshot.id}.json`;
                link.click();
            } finally {
                URL.revokeObjectURL(url);
            }
        } catch {
            setNotice('Snapshot export unavailable.');
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
                    <legend>Server structure snapshots</legend>
                    <p>
                        Use /snapshot create in Discord for a manual snapshot,
                        with template:true for a reusable template. Exports
                        contain roles, channel metadata and permission
                        assignments. Keep them private. Messages and member
                        accounts are outside this snapshot.
                    </p>
                    <p>
                        Up to ten snapshots are retained, including five
                        templates. New captures replace the oldest non-template
                        when full. Templates still expire at the selected
                        retention period. Scheduled captures record current
                        structure without replaying missed intervals.
                    </p>
                    <label className="block">
                        <input
                            type="checkbox"
                            checked={scheduled}
                            onChange={(event) =>
                                setScheduled(event.target.checked)
                            }
                        />{' '}
                        Capture on a schedule when this module is enabled
                    </label>
                    <label className="block">
                        Capture interval (hours)
                        <input
                            type="number"
                            required
                            min={24}
                            max={168}
                            value={interval}
                            onChange={(event) =>
                                setInterval(Number(event.target.value))
                            }
                            className="block w-full p-2 bg-bl-panel rounded"
                        />
                    </label>
                    <label className="block">
                        Retention (days)
                        <input
                            type="number"
                            required
                            min={7}
                            max={90}
                            value={retainDays}
                            onChange={(event) =>
                                setRetainDays(Number(event.target.value))
                            }
                            className="block w-full p-2 bg-bl-panel rounded"
                        />
                    </label>
                    <label className="block">
                        Protected channel IDs (comma-separated)
                        <textarea
                            value={protectedChannels}
                            onChange={(event) =>
                                setProtectedChannels(event.target.value)
                            }
                            className="block w-full p-2 bg-bl-panel rounded"
                        />
                    </label>
                    <label className="block">
                        Protected role IDs (comma-separated)
                        <textarea
                            value={protectedRoles}
                            onChange={(event) =>
                                setProtectedRoles(event.target.value)
                            }
                            className="block w-full p-2 bg-bl-panel rounded"
                        />
                    </label>
                    <button type="submit">Save snapshot settings</button>
                </fieldset>
            </form>
            {notice && <p role="status">{notice}</p>}
            {error && <p role="alert">{error}</p>}
            {!error && !snapshots && <p role="status">Loading snapshots…</p>}
            {snapshots && !snapshots.length && (
                <p>No retained server snapshots.</p>
            )}
            <ul>
                {snapshots?.map((snapshot) => (
                    <li
                        key={snapshot.id}
                        className="border border-bl-surface p-3 rounded break-words"
                    >
                        <p>
                            {snapshot.kind} ·{' '}
                            {new Date(snapshot.createdAt).toLocaleString()} ·
                            expires{' '}
                            {new Date(snapshot.expiresAt).toLocaleString()}
                        </p>
                        <p>ID: {snapshot.id}</p>
                        <p className="break-all">
                            SHA-256: {snapshot.checksum}
                        </p>
                        <button
                            disabled={busy}
                            type="button"
                            onClick={() => {
                                void download(snapshot);
                            }}
                        >
                            Download manifest
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
