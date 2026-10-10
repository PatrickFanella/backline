import { useState, type FormEvent } from 'react';

import api from '../lib/api';

type Props = {
    guildId: string;
    enabled: boolean;
    config: Record<string, unknown>;
    onBusy: (busy: boolean) => void;
    onSaved: () => Promise<void>;
};
export default function AudioConfig({
    guildId,
    enabled,
    config,
    onBusy,
    onSaved,
}: Props) {
    const [station, setStation] = useState(
        String(config.defaultStation ?? 'defcon')
    );
    const [roles, setRoles] = useState(
        Array.isArray(config.djRoles) ? config.djRoles.join(', ') : ''
    );
    const [clipsEnabled, setClipsEnabled] = useState(
        config.clipsEnabled === true
    );
    const [queuesEnabled, setQueuesEnabled] = useState(
        config.queuesEnabled === true
    );
    const [volume, setVolume] = useState(Number(config.volume ?? 25));
    const [duration, setDuration] = useState(Number(config.maxMinutes ?? 30));
    const [idle, setIdle] = useState(Number(config.idleSeconds ?? 60));
    const [busy, setBusy] = useState(false),
        [notice, setNotice] = useState('');
    async function save(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        onBusy(true);
        setNotice('');
        try {
            await api.put(`/guilds/${guildId}/modules/audio`, {
                enabled,
                config: {
                    queuesEnabled,
                    clipsEnabled,
                    defaultStation: station,
                    djRoles: roles.split(/[\s,]+/).filter(Boolean),
                    volume,
                    maxMinutes: duration,
                    idleSeconds: idle,
                },
            });
            await onSaved();
            setNotice('Radio settings saved.');
        } catch {
            setNotice(
                'Radio settings were not saved. Check station ID and server permissions.'
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
                <legend className="bl-legend">SomaFM radio settings</legend>
                <label className="bl-label">
                    <input
                        type="checkbox"
                        checked={clipsEnabled}
                        onChange={(event) =>
                            setClipsEnabled(event.target.checked)
                        }
                    />{' '}
                    Enable manager-approved short audio clips
                </label>
                <label className="bl-label">
                    <input
                        type="checkbox"
                        checked={queuesEnabled}
                        onChange={(event) =>
                            setQueuesEnabled(event.target.checked)
                        }
                    />{' '}
                    Enable timed station queues and playlists
                </label>
                <p>
                    Members queue up to ten segments each with /audio enqueue; a
                    DJ explicitly starts playback. /audio offers pause, resume,
                    skip votes, shuffle, loop and saved playlists. Queues stop
                    at the server duration limit and require explicit restart
                    after interruption. Skip votes require half of current human
                    listeners; requester or DJ can skip immediately.
                </p>
                <label className="bl-label">
                    Default station ID
                    <input
                        required
                        pattern="[a-z0-9-]{1,40}"
                        className="bl-input"
                        value={station}
                        onChange={(event) => setStation(event.target.value)}
                    />
                </label>
                <label className="bl-label">
                    DJ role IDs (optional, comma-separated)
                    <input
                        className="bl-input"
                        value={roles}
                        onChange={(event) => setRoles(event.target.value)}
                    />
                </label>
                <label className="bl-label">
                    Volume (%)
                    <input
                        type="number"
                        required
                        min={0}
                        max={100}
                        className="bl-input-compact"
                        value={volume}
                        onChange={(event) =>
                            setVolume(Number(event.target.value))
                        }
                    />
                </label>
                <label className="bl-label">
                    Stop after (minutes)
                    <input
                        type="number"
                        required
                        min={1}
                        max={120}
                        className="bl-input-compact"
                        value={duration}
                        onChange={(event) =>
                            setDuration(Number(event.target.value))
                        }
                    />
                </label>
                <label className="bl-label">
                    Stop when channel is empty for (seconds)
                    <input
                        type="number"
                        required
                        min={10}
                        max={300}
                        className="bl-input-compact"
                        value={idle}
                        onChange={(event) =>
                            setIdle(Number(event.target.value))
                        }
                    />
                </label>
                <p className="text-sm text-bl-muted">
                    Join a voice channel and use /radio play. DEF CON Radio uses
                    station ID defcon; /radio stations lists the catalog.
                    Sources come from SomaFM’s published playlists. With no DJ
                    roles configured, members may start radio in their own voice
                    channel. Only the requester or a DJ may replace or stop it.
                    Playback stops on disable, permission loss, empty-channel
                    timeout or the duration limit.
                </p>
                <a
                    href="https://somafm.com/defcon/"
                    target="_blank"
                    rel="noreferrer"
                    className="block underline"
                >
                    DEF CON Radio on SomaFM
                </a>
                <button
                    type="submit"
                    className="bl-button bl-button-secondary bl-button-sm"
                >
                    {busy ? 'Saving…' : 'Save radio settings'}
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
