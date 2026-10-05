import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import api from '../lib/api';

type Clip = {
    id: string;
    title: string;
    byteSize: number;
    durationMs: number;
    source: string;
    license: string;
    rights: string;
    approvedBy: string;
};
type Board = { id: string; name: string; clipIds: string[] };
type Props = { guildId: string; onBusy: (busy: boolean) => void };
export default function AudioClips({ guildId, onBusy }: Props) {
    const [clips, setClips] = useState<Clip[] | null>(null),
        [boards, setBoards] = useState<Board[] | null>(null),
        [error, setError] = useState(''),
        [notice, setNotice] = useState(''),
        [busy, setBusy] = useState(false);
    const [title, setTitle] = useState(''),
        [source, setSource] = useState(''),
        [license, setLicense] = useState(''),
        [rights, setRights] = useState('original'),
        [confirmed, setConfirmed] = useState(false),
        [file, setFile] = useState<File | null>(null);
    const [name, setName] = useState(''),
        [selected, setSelected] = useState<string[]>([]),
        [search, setSearch] = useState('');
    useEffect(() => {
        let live = true;
        Promise.all([
            api.get<Clip[]>(`/guilds/${guildId}/modules/audio/clips`),
            api.get<Board[]>(`/guilds/${guildId}/modules/audio/soundboards`),
        ])
            .then(([c, b]) => {
                if (live) {
                    setClips(c.data);
                    setBoards(b.data);
                }
            })
            .catch(() => {
                if (live) setError('Audio catalog could not be loaded.');
            });
        return () => {
            live = false;
        };
    }, [guildId]);
    async function refresh() {
        const [c, b] = await Promise.all([
            api.get<Clip[]>(`/guilds/${guildId}/modules/audio/clips`),
            api.get<Board[]>(`/guilds/${guildId}/modules/audio/soundboards`),
        ]);
        setClips(c.data);
        setBoards(b.data);
        setError('');
    }
    async function action(fn: () => Promise<void>) {
        setBusy(true);
        onBusy(true);
        setNotice('');
        try {
            await fn();
            await refresh();
        } catch {
            setNotice(
                'Audio change was not completed. Check clip settings, WAV format, provenance and quota.'
            );
        } finally {
            setBusy(false);
            onBusy(false);
        }
    }
    function upload(event: FormEvent) {
        event.preventDefault();
        if (!file || !confirmed || file.size > 3 * 1024 * 1024) {
            setNotice(
                'Select a WAV up to three MiB and confirm your approval.'
            );
            return;
        }
        void action(async () => {
            await api.post(
                `/guilds/${guildId}/modules/audio/clips`,
                await file.arrayBuffer(),
                {
                    headers: { 'Content-Type': 'audio/wav' },
                    params: { title, source, license, rights, confirmed: true },
                }
            );
            setNotice('Clip approved and stored.');
        });
    }
    function save(event: FormEvent) {
        event.preventDefault();
        void action(async () => {
            await api.put(`/guilds/${guildId}/modules/audio/soundboards`, {
                name,
                clipIds: selected,
            });
            setNotice('Soundboard saved.');
        });
    }
    return (
        <section className="space-y-3 mt-4">
            <h3>Approved clips and soundboards</h3>
            <p>
                Enable clips in audio settings and save first. Upload canonical
                16-bit PCM WAV: mono or stereo, 44.1 or 48 kHz, 0.05–15 seconds,
                up to three MiB. One hundred clips and fifty MiB per server;
                unused bytes expire after ninety days. Removing a clip withdraws
                its approval. Soundboards referencing it need to be updated
                before queueing.
            </p>
            <form onSubmit={upload}>
                <fieldset disabled={busy} className="space-y-2">
                    <legend>Approve an audio clip</legend>
                    <label className="block">
                        Clip title
                        <input
                            required
                            maxLength={60}
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                        />
                    </label>
                    <label className="block">
                        WAV file
                        <input
                            required
                            type="file"
                            accept=".wav,audio/wav"
                            onChange={(e) =>
                                setFile(e.target.files?.[0] ?? null)
                            }
                        />
                    </label>
                    <label className="block">
                        Source or creator
                        <input
                            required
                            maxLength={400}
                            value={source}
                            onChange={(e) => setSource(e.target.value)}
                        />
                    </label>
                    <label className="block">
                        License or permission record
                        <input
                            required
                            maxLength={200}
                            value={license}
                            onChange={(e) => setLicense(e.target.value)}
                        />
                    </label>
                    <label className="block">
                        Provenance
                        <select
                            value={rights}
                            onChange={(e) => setRights(e.target.value)}
                        >
                            <option value="original">Original audio</option>
                            <option value="licensed">
                                Licensed or permission granted
                            </option>
                        </select>
                    </label>
                    <label className="block">
                        <input
                            required
                            type="checkbox"
                            checked={confirmed}
                            onChange={(e) => setConfirmed(e.target.checked)}
                        />{' '}
                        I reviewed this audio and approve its use in this
                        server.
                    </label>
                    <button type="submit">Approve and upload clip</button>
                </fieldset>
            </form>
            <label className="block">
                Search clip titles
                <input
                    maxLength={60}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </label>
            {error && <p role="alert">{error}</p>}
            {notice && <p role="status">{notice}</p>}
            {!clips && !error && <p role="status">Loading clips…</p>}
            {clips?.length === 0 && <p>No approved clips.</p>}
            <ul>
                {clips
                    ?.filter((c) =>
                        c.title
                            .toLocaleLowerCase()
                            .includes(search.toLocaleLowerCase())
                    )
                    .map((c) => (
                        <li
                            key={c.id}
                            className="border border-ctp-surface1 p-3 rounded break-words"
                        >
                            <strong>{c.title}</strong> · {c.durationMs} ms ·{' '}
                            {c.byteSize} bytes<p>{c.id}</p>
                            <p>
                                Source: {c.source} · {c.rights} · {c.license} ·
                                approved by {c.approvedBy}
                            </p>
                            <p>Use /clip play with this ID.</p>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                    void action(async () => {
                                        await api.delete(
                                            `/guilds/${guildId}/modules/audio/clips/${c.id}`
                                        );
                                        setSelected((ids) =>
                                            ids.filter((id) => id !== c.id)
                                        );
                                        setNotice('Clip approval withdrawn.');
                                    });
                                }}
                            >
                                Remove {c.title}
                            </button>
                        </li>
                    ))}
            </ul>
            <form onSubmit={save}>
                <fieldset disabled={busy} className="space-y-2">
                    <legend>Save a soundboard</legend>
                    <label className="block">
                        Soundboard name
                        <input
                            required
                            maxLength={40}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </label>
                    <p>
                        Select one to twenty approved clips in the order you
                        select. A server may save twenty soundboards.
                    </p>
                    {clips?.map((c) => (
                        <label className="block" key={c.id}>
                            <input
                                type="checkbox"
                                checked={selected.includes(c.id)}
                                onChange={(e) =>
                                    setSelected((ids) =>
                                        e.target.checked
                                            ? [...ids, c.id]
                                            : ids.filter((id) => id !== c.id)
                                    )
                                }
                            />{' '}
                            Include {c.title}
                        </label>
                    ))}
                    <button
                        type="submit"
                        disabled={!selected.length || selected.length > 20}
                    >
                        Save soundboard
                    </button>
                </fieldset>
            </form>
            <ul>
                {boards?.map((b) => (
                    <li key={b.id}>
                        {b.name} · {b.clipIds.length} clips · /clip queue-board
                        <button
                            disabled={busy}
                            type="button"
                            onClick={() => {
                                setName(b.name);
                                setSelected(
                                    b.clipIds.filter((id) =>
                                        clips?.some((clip) => clip.id === id)
                                    )
                                );
                            }}
                        >
                            Edit {b.name}
                        </button>
                        <button
                            disabled={busy}
                            type="button"
                            onClick={() => {
                                void action(async () => {
                                    await api.delete(
                                        `/guilds/${guildId}/modules/audio/soundboards/${b.id}`
                                    );
                                    setNotice('Soundboard deleted.');
                                });
                            }}
                        >
                            Delete {b.name}
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
