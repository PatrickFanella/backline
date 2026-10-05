import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import api from '../lib/api';

type Props = {
    guildId: string;
    enabled: boolean;
    config: Record<string, unknown>;
    onSaved: () => Promise<void>;
    onBusy: (value: boolean) => void;
};
type Entry = {
    id: string;
    memberId: string;
    actorId: string;
    kind: string;
    delta: number;
    balanceAfter: number;
    reason: string;
    createdAt: string;
};
export default function EconomyConfig({
    guildId,
    enabled,
    config,
    onSaved,
    onBusy,
}: Props) {
    const [currencyName, setCurrencyName] = useState(
        String(config.currencyName ?? 'Credits')
    );
    const [dailyReward, setDailyReward] = useState(
        Number(config.dailyReward ?? 100)
    );
    const [gamesEnabled, setGamesEnabled] = useState(
        config.gamesEnabled === true
    );
    const [shopEnabled, setShopEnabled] = useState(config.shopEnabled === true);
    const [busy, setBusy] = useState(false),
        [notice, setNotice] = useState(''),
        [error, setError] = useState(''),
        [entries, setEntries] = useState<Entry[] | null>(null);
    useEffect(() => {
        let active = true;
        api.get<Entry[]>(`/guilds/${guildId}/modules/economy/ledger`)
            .then((r) => {
                if (active) setEntries(r.data);
            })
            .catch(() => {
                if (active) setError('Economy ledger could not be loaded.');
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
            await api.put(`/guilds/${guildId}/modules/economy`, {
                enabled,
                config: {
                    currencyName,
                    dailyReward,
                    gamesEnabled,
                    shopEnabled,
                },
            });
            await onSaved();
            setNotice('Economy settings saved.');
        } catch {
            setNotice(
                'Economy settings were not saved. Check the name and daily reward limits.'
            );
        } finally {
            setBusy(false);
            onBusy(false);
        }
    }
    return (
        <section className="space-y-3">
            <form
                onSubmit={(e) => {
                    void save(e);
                }}
            >
                <fieldset disabled={busy} className="space-y-3">
                    <legend>Fictional server economy</legend>
                    <p>
                        Members opt in with /economy join. Points have no cash
                        value. /economy daily gives one reward per UTC day.
                        /economy leave stops participation while preserving the
                        balance and collection. All game replies are private;
                        this module sends no game notifications.
                    </p>
                    <p>
                        Balances stay between zero and one million. Games allow
                        up to one hundred points per coin flip, with a
                        ten-second cooldown. The shop sells eight original
                        fictional objects. /economy adjust requires current
                        Manage Server permission and a recorded reason.
                    </p>
                    <label className="block">
                        Currency name
                        <input
                            required
                            maxLength={20}
                            value={currencyName}
                            onChange={(e) => setCurrencyName(e.target.value)}
                            className="block w-full p-2 bg-ctp-surface0 rounded"
                        />
                    </label>
                    <label className="block">
                        Daily reward
                        <input
                            required
                            type="number"
                            min={1}
                            max={1000}
                            value={dailyReward}
                            onChange={(e) =>
                                setDailyReward(Number(e.target.value))
                            }
                            className="block w-full p-2 bg-ctp-surface0 rounded"
                        />
                    </label>
                    <label className="block">
                        <input
                            type="checkbox"
                            checked={gamesEnabled}
                            onChange={(e) => setGamesEnabled(e.target.checked)}
                        />{' '}
                        Enable coin games
                    </label>
                    <label className="block">
                        <input
                            type="checkbox"
                            checked={shopEnabled}
                            onChange={(e) => setShopEnabled(e.target.checked)}
                        />{' '}
                        Enable the fictional collection shop
                    </label>
                    <button type="submit">Save economy settings</button>
                </fieldset>
            </form>
            {notice && <p role="status">{notice}</p>}
            {error && <p role="alert">{error}</p>}
            {!entries && !error && <p role="status">Loading ledger…</p>}
            {entries?.length === 0 && <p>No economy entries are recorded.</p>}
            <p>
                Latest one hundred entries. Receipts expire after ninety days;
                balances and opt-out records persist. Limits: one thousand
                retained accounts and one hundred thousand receipts per server.
            </p>
            <ul>
                {entries?.map((entry) => (
                    <li
                        key={entry.id}
                        className="border border-ctp-surface1 p-3 rounded break-words"
                    >
                        {entry.kind}: {entry.delta >= 0 ? '+' : ''}
                        {entry.delta}; balance {entry.balanceAfter}
                        <p>
                            Member {entry.memberId} · actor {entry.actorId} ·{' '}
                            {new Date(entry.createdAt).toLocaleString()}
                        </p>
                        <p>{entry.reason}</p>
                    </li>
                ))}
            </ul>
        </section>
    );
}
