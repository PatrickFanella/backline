import { useCallback, useEffect, useState } from 'react';

import api from '../lib/api';

type QueueItem = {
    id: string;
    station?: string;
    clipId?: string;
    minutes: number;
    requesterId: string;
};
type Diagnostics = {
    stations: { id: string; title: string }[];
    queue: {
        items: QueueItem[];
        state: string;
        loop: boolean;
        shuffle: boolean;
    };
    playlists: { id: string; name: string; items: QueueItem[] }[];
    playback: {
        id: string;
        stationId: string;
        state: string;
        detail: string | null;
        playbackMs: number;
        daveProtocol: number | null;
    }[];
    jobs: { id: string; state: string; lastError: string | null }[];
};
type Props = { guildId: string; onBusy: (busy: boolean) => void };

export default function AudioQueue({ guildId, onBusy }: Props) {
    const [data, setData] = useState<Diagnostics | null>(null);
    const [station, setStation] = useState('defcon');
    const [minutes, setMinutes] = useState(10);
    const [volume, setVolume] = useState(25);
    const [name, setName] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const refresh = useCallback(async () => {
        const response = await api.get<Diagnostics>(
            `/guilds/${guildId}/modules/audio/diagnostics`
        );
        setData(response.data);
    }, [guildId]);
    useEffect(() => {
        void refresh().catch(() =>
            setNotice('Audio diagnostics are unavailable.')
        );
    }, [refresh]);
    async function action(payload: Record<string, unknown>) {
        setBusy(true);
        onBusy(true);
        setNotice('');
        try {
            const response = await api.post<{ id: string }>(
                `/guilds/${guildId}/modules/audio/actions`,
                { ...payload, requestId: crypto.randomUUID() }
            );
            setNotice(
                `Audio action queued: ${response.data.id}. It runs only in the bot worker after fresh voice and DJ checks.`
            );
            await refresh();
        } catch {
            setNotice(
                'Audio action was not queued. Check current server access and audio settings.'
            );
        } finally {
            setBusy(false);
            onBusy(false);
        }
    }
    return (
        <section
            className="space-y-3 mt-5"
            aria-labelledby="audio-queue-heading"
        >
            <h4 id="audio-queue-heading" className="font-medium">
                Queue and playback diagnostics
            </h4>
            <p className="text-sm text-bl-muted">
                The dashboard records an action for the bot worker; it cannot
                control voice playback directly. Join the intended voice channel
                before starting or controlling playback.
            </p>
            <div className="flex gap-2 flex-wrap">
                <label>
                    Station{' '}
                    <select
                        value={station}
                        onChange={(event) => setStation(event.target.value)}
                    >
                        {data?.stations.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                                {entry.title} ({entry.id})
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    Minutes{' '}
                    <input
                        type="number"
                        min={1}
                        max={30}
                        value={minutes}
                        onChange={(event) =>
                            setMinutes(Number(event.target.value))
                        }
                    />
                </label>
                <button
                    disabled={busy}
                    type="button"
                    onClick={() =>
                        void action({ action: 'enqueue', station, minutes })
                    }
                >
                    Queue station
                </button>
                <label>
                    Volume{' '}
                    <input
                        type="number"
                        min={0}
                        max={100}
                        value={volume}
                        onChange={(event) =>
                            setVolume(Number(event.target.value))
                        }
                    />
                </label>
                <button
                    disabled={busy || volume < 0 || volume > 100}
                    type="button"
                    onClick={() => void action({ action: 'volume', volume })}
                >
                    Set volume
                </button>
                <button
                    disabled={busy}
                    type="button"
                    onClick={() => void action({ action: 'start' })}
                >
                    Start queue
                </button>
            </div>
            <div className="flex gap-2 flex-wrap">
                {(['pause', 'resume', 'skip', 'stop'] as const).map(
                    (control) => (
                        <button
                            disabled={busy}
                            key={control}
                            type="button"
                            onClick={() =>
                                void action({ action: 'control', control })
                            }
                        >
                            {control}
                        </button>
                    )
                )}
                <button
                    disabled={busy}
                    type="button"
                    onClick={() =>
                        void action({
                            action: 'queue-setting',
                            setting: 'shuffle',
                            enabled: !data?.queue.shuffle,
                        })
                    }
                >
                    Shuffle: {data?.queue.shuffle ? 'on' : 'off'}
                </button>
                <button
                    disabled={busy}
                    type="button"
                    onClick={() =>
                        void action({
                            action: 'queue-setting',
                            setting: 'loop',
                            enabled: !data?.queue.loop,
                        })
                    }
                >
                    Loop: {data?.queue.loop ? 'on' : 'off'}
                </button>
                <button
                    disabled={busy}
                    type="button"
                    onClick={() =>
                        void action({
                            action: 'queue-setting',
                            setting: 'clear',
                        })
                    }
                >
                    Clear stopped queue
                </button>
            </div>
            <div className="flex gap-2 flex-wrap">
                <input
                    value={name}
                    maxLength={40}
                    placeholder="Playlist name"
                    onChange={(event) => setName(event.target.value)}
                />
                <button
                    disabled={busy || !name.trim()}
                    type="button"
                    onClick={() =>
                        void action({
                            action: 'playlist',
                            operation: 'save',
                            name,
                        })
                    }
                >
                    Save queue
                </button>
                {data?.playlists.map((playlist) => (
                    <span key={playlist.id}>
                        {playlist.name} ({playlist.items.length}){' '}
                        <button
                            disabled={busy}
                            type="button"
                            onClick={() =>
                                void action({
                                    action: 'playlist',
                                    operation: 'load',
                                    name: playlist.name,
                                })
                            }
                        >
                            Load
                        </button>{' '}
                        <button
                            disabled={busy}
                            type="button"
                            onClick={() =>
                                void action({
                                    action: 'playlist',
                                    operation: 'delete',
                                    name: playlist.name,
                                })
                            }
                        >
                            Delete
                        </button>
                    </span>
                ))}
            </div>
            {notice && <p role="status">{notice}</p>}
            <p>
                Queue state: {data?.queue.state ?? 'loading'} ·{' '}
                {data?.queue.items.length ?? 0} pending entries.
            </p>
            <ul>
                {data?.queue.items.map((item) => (
                    <li key={item.id}>
                        {item.station ?? `clip ${item.clipId}`} · {item.minutes}{' '}
                        minutes · requester {item.requesterId}
                    </li>
                ))}
            </ul>
            <h5 className="font-medium">Recorded playback</h5>
            <ul>
                {data?.playback.map((entry) => (
                    <li key={entry.id}>
                        {entry.stationId} · {entry.state} · {entry.playbackMs}{' '}
                        ms{entry.detail ? ` · ${entry.detail}` : ''}
                        {entry.daveProtocol
                            ? ` · DAVE ${entry.daveProtocol}`
                            : ''}
                    </li>
                ))}
            </ul>
            <h5 className="font-medium">Recent dashboard actions</h5>
            <ul>
                {data?.jobs.map((job) => (
                    <li key={job.id}>
                        {job.id} · {job.state}
                        {job.lastError ? ` · ${job.lastError}` : ''}
                    </li>
                ))}
            </ul>
        </section>
    );
}
