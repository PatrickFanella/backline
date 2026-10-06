import { useState } from 'react';
import type { FormEvent } from 'react';

import api from '../lib/api';

type Props = {
    guildId: string;
    enabled: boolean;
    config: Record<string, unknown>;
    onSaved: () => Promise<void>;
    onBusy: (busy: boolean) => void;
};
type Entry = {
    memberId: string;
    displayName: string;
    xp: number;
    level: number;
};
const numeric = [
    ['messageXp', 'XP per message', 15, 1, 100],
    ['cooldownSeconds', 'Message cooldown (seconds)', 60, 30, 3600],
    ['minMessageLength', 'Minimum message length', 8, 1, 100],
    ['voiceXp', 'XP per eligible voice minute', 3, 1, 10],
    ['retentionDays', 'Inactive profile retention (days)', 90, 1, 365],
] as const;
const split = (value: string) =>
    value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
export default function LevelingConfig({
    guildId,
    enabled,
    config,
    onSaved,
    onBusy,
}: Props) {
    const [numbers, setNumbers] = useState<Record<string, number>>(
        Object.fromEntries(
            numeric.map(([key, , fallback]) => [
                key,
                Number(config[key] ?? fallback),
            ])
        )
    );
    const [flags, setFlags] = useState({
        voiceEnabled: config.voiceEnabled === true,
        excludeDeafened: config.excludeDeafened !== false,
        excludeMuted: config.excludeMuted !== false,
        excludeSolo: config.excludeSolo !== false,
    });
    const [channels, setChannels] = useState(
        Array.isArray(config.excludedChannels)
            ? config.excludedChannels.join(', ')
            : ''
    );
    const [roles, setRoles] = useState(
        Array.isArray(config.excludedRoles)
            ? config.excludedRoles.join(', ')
            : ''
    );
    const [rewards, setRewards] = useState<{ roleId: string; level: number }[]>(
        Array.isArray(config.rewards)
            ? (config.rewards as { roleId: string; level: number }[])
            : []
    );
    const [rows, setRows] = useState<Entry[]>([]);
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    async function save(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        onBusy(true);
        setNotice('');
        try {
            await api.put(`/guilds/${guildId}/modules/leveling`, {
                enabled,
                config: {
                    ...numbers,
                    ...flags,
                    excludedChannels: split(channels),
                    excludedRoles: split(roles),
                    rewards,
                },
            });
            await onSaved();
            setNotice('Leveling settings saved.');
        } catch {
            setNotice(
                'Settings were not saved. Check limits and IDs. Voice XP requires the operator to enable Voice States and restart the bot.'
            );
        } finally {
            setBusy(false);
            onBusy(false);
        }
    }
    async function load() {
        setBusy(true);
        onBusy(true);
        try {
            const response = await api.get<{ leaderboard: Entry[] }>(
                `/guilds/${guildId}/leveling`
            );
            setRows(response.data.leaderboard);
            setNotice(
                response.data.leaderboard.length
                    ? 'Top 25 members in this server.'
                    : 'No XP earned in this server yet.'
            );
        } catch {
            setNotice('Server leaderboard unavailable.');
        } finally {
            setBusy(false);
            onBusy(false);
        }
    }
    return (
        <div className="space-y-3 mt-4">
            <form
                onSubmit={(event) => {
                    void save(event);
                }}
            >
                <fieldset disabled={busy} className="space-y-3">
                    <legend className="font-medium">Leveling settings</legend>
                    <p className="text-sm text-bl-muted">
                        Repeated messages earn no XP for 24 hours. Message
                        content is discarded after checking. AFK channels and
                        bots earn no voice XP. Partial voice minutes reset after
                        a restart or voice eligibility change.
                    </p>
                    {numeric.map(([key, label, , min, max]) => (
                        <label key={key} className="block">
                            {label}
                            <input
                                type="number"
                                required
                                min={min}
                                max={max}
                                value={numbers[key]}
                                onChange={(event) =>
                                    setNumbers((value) => ({
                                        ...value,
                                        [key]: Number(event.target.value),
                                    }))
                                }
                                className="block p-2 rounded bg-bl-panel"
                            />
                        </label>
                    ))}
                    {Object.entries({
                        voiceEnabled: 'Enable voice XP',
                        excludeDeafened: 'Exclude deafened members',
                        excludeMuted: 'Exclude muted members',
                        excludeSolo:
                            'Require another human in the voice channel',
                    }).map(([key, label]) => (
                        <label key={key} className="flex gap-2">
                            <input
                                type="checkbox"
                                checked={flags[key as keyof typeof flags]}
                                onChange={(event) =>
                                    setFlags((value) => ({
                                        ...value,
                                        [key]: event.target.checked,
                                    }))
                                }
                            />
                            {label}
                        </label>
                    ))}
                    <label className="block">
                        Excluded channel IDs, separated by commas
                        <input
                            value={channels}
                            onChange={(event) =>
                                setChannels(event.target.value)
                            }
                            className="block w-full p-2 rounded bg-bl-panel"
                        />
                    </label>
                    <label className="block">
                        Excluded role IDs, separated by commas
                        <input
                            value={roles}
                            onChange={(event) => setRoles(event.target.value)}
                            className="block w-full p-2 rounded bg-bl-panel"
                        />
                    </label>
                    <p className="text-sm text-bl-muted">
                        Level rewards accept basic chat and voice roles below
                        the bot. Rewards are added once and remain assigned when
                        a profile expires. No rewards are configured by default.
                    </p>
                    {rewards.map((reward, index) => (
                        <div key={index} className="flex flex-wrap gap-2">
                            <label>
                                Reward role ID
                                <input
                                    required
                                    pattern="[0-9]{17,20}"
                                    value={reward.roleId}
                                    onChange={(event) =>
                                        setRewards((value) =>
                                            value.map((row, i) =>
                                                i === index
                                                    ? {
                                                          ...row,
                                                          roleId: event.target
                                                              .value,
                                                      }
                                                    : row
                                            )
                                        )
                                    }
                                    className="block p-2 rounded bg-bl-panel"
                                />
                            </label>
                            <label>
                                Required level
                                <input
                                    type="number"
                                    required
                                    min={1}
                                    max={1000}
                                    value={reward.level}
                                    onChange={(event) =>
                                        setRewards((value) =>
                                            value.map((row, i) =>
                                                i === index
                                                    ? {
                                                          ...row,
                                                          level: Number(
                                                              event.target.value
                                                          ),
                                                      }
                                                    : row
                                            )
                                        )
                                    }
                                    className="block p-2 rounded bg-bl-panel"
                                />
                            </label>
                            <button
                                type="button"
                                onClick={() =>
                                    setRewards((value) =>
                                        value.filter((_, i) => i !== index)
                                    )
                                }
                            >
                                Remove reward {index + 1}
                            </button>
                        </div>
                    ))}
                    <button
                        type="button"
                        disabled={rewards.length >= 10}
                        onClick={() =>
                            setRewards((value) => [
                                ...value,
                                { roleId: '', level: 1 },
                            ])
                        }
                        className="border rounded p-2"
                    >
                        Add role reward
                    </button>
                    <button type="submit" className="border rounded p-2 ml-2">
                        {busy ? 'Saving…' : 'Save leveling settings'}
                    </button>
                </fieldset>
            </form>
            <button
                type="button"
                disabled={busy}
                onClick={() => {
                    void load();
                }}
                className="border rounded p-2"
            >
                View server leaderboard
            </button>
            {notice && <p role="status">{notice}</p>}
            <ol>
                {rows.map((row) => (
                    <li key={row.memberId}>
                        {row.displayName} ({row.memberId}) · level {row.level} ·{' '}
                        {row.xp} XP
                    </li>
                ))}
            </ol>
        </div>
    );
}
