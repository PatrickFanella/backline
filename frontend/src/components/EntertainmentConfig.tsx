import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import api from '../lib/api';

type Template = {
    id: string;
    name: string;
    description: string;
    provenance: {
        creator: string;
        source: string;
        license: string;
        assets: string;
    };
};
type Trade = {
    id: string;
    itemId: string;
    quantity: number;
    price: number;
    state: string;
    sellerId: string;
    buyerId: string;
};
type Props = {
    guildId: string;
    enabled: boolean;
    config: Record<string, unknown>;
    onSaved: () => Promise<void>;
    onBusy: (value: boolean) => void;
};
export default function EntertainmentConfig({
    guildId,
    enabled,
    config,
    onSaved,
    onBusy,
}: Props) {
    const [approved, setApproved] = useState<string[]>(
        Array.isArray(config.approvedTemplates)
            ? (config.approvedTemplates as string[])
            : []
    );
    const [collectionsEnabled, setCollectionsEnabled] = useState(
        config.collectionsEnabled === true
    );
    const [templates, setTemplates] = useState<Template[] | null>(null),
        [trades, setTrades] = useState<Trade[] | null>(null),
        [error, setError] = useState(''),
        [notice, setNotice] = useState(''),
        [busy, setBusy] = useState(false);
    const [previews, setPreviews] = useState<Record<string, string>>({});
    const live = useRef(true),
        urls = useRef(new Set<string>());
    useEffect(() => {
        let active = true;
        Promise.all([
            api.get<Template[]>(
                `/guilds/${guildId}/modules/entertainment/catalog`
            ),
            api.get<Trade[]>(`/guilds/${guildId}/modules/entertainment/trades`),
        ])
            .then(([catalog, history]) => {
                if (active) {
                    setTemplates(catalog.data);
                    setTrades(history.data);
                }
            })
            .catch(() => {
                if (active)
                    setError(
                        'Entertainment catalog or trade history could not be loaded.'
                    );
            });
        return () => {
            active = false;
        };
    }, [guildId]);
    useEffect(() => {
        live.current = true;
        const activeUrls = urls.current;
        return () => {
            live.current = false;
            activeUrls.forEach((url) => URL.revokeObjectURL(url));
            activeUrls.clear();
        };
    }, []);
    async function preview(id: string) {
        setBusy(true);
        onBusy(true);
        try {
            const response = await api.get(
                `/guilds/${guildId}/modules/entertainment/templates/${id}/preview`,
                { responseType: 'blob' }
            );
            if (!live.current) return;
            const url = URL.createObjectURL(response.data);
            urls.current.add(url);
            setPreviews((previous) => {
                if (previous[id]) {
                    URL.revokeObjectURL(previous[id]);
                    urls.current.delete(previous[id]);
                }
                return { ...previous, [id]: url };
            });
        } catch {
            setNotice('Template preview unavailable.');
        } finally {
            setBusy(false);
            onBusy(false);
        }
    }
    async function save(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        onBusy(true);
        try {
            await api.put(`/guilds/${guildId}/modules/entertainment`, {
                enabled,
                config: { approvedTemplates: approved, collectionsEnabled },
            });
            await onSaved();
            setNotice('Entertainment approvals saved.');
        } catch {
            setNotice('Entertainment settings were not saved.');
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
                    <legend>Original entertainment and collections</legend>
                    <p>
                        Review each original layout before approving it for /fun
                        meme. Captions and rendered images are not retained.
                        Jokes, dice and eight-ball replies are private; answers
                        are entertainment only. Members get at most five new
                        requests per minute.
                    </p>
                    {templates?.map((template) => (
                        <fieldset
                            key={template.id}
                            className="border border-bl-border/60 p-3 rounded"
                        >
                            <legend>{template.name}</legend>
                            <p>{template.description}</p>
                            <p>
                                {template.provenance.creator} ·{' '}
                                {template.provenance.license}
                            </p>
                            <p>{template.provenance.assets}</p>
                            <p>Source: {template.provenance.source}</p>
                            <button
                                type="button"
                                onClick={() => {
                                    void preview(template.id);
                                }}
                            >
                                Preview {template.name}
                            </button>
                            {previews[template.id] && (
                                <img
                                    src={previews[template.id]}
                                    width={256}
                                    height={256}
                                    alt={`${template.name} sample layout`}
                                />
                            )}
                            <label className="bl-label">
                                <input
                                    type="checkbox"
                                    checked={approved.includes(template.id)}
                                    onChange={(e) =>
                                        setApproved((values) =>
                                            e.target.checked
                                                ? [...values, template.id]
                                                : values.filter(
                                                      (id) => id !== template.id
                                                  )
                                        )
                                    }
                                />{' '}
                                Approve {template.name}
                            </label>
                        </fieldset>
                    ))}
                    <label className="bl-label">
                        <input
                            type="checkbox"
                            checked={collectionsEnabled}
                            onChange={(e) =>
                                setCollectionsEnabled(e.target.checked)
                            }
                        />{' '}
                        Enable collection claims and trading
                    </label>
                    <p>
                        Collections require economy enabled and individual
                        /economy join. /fun collect gives one fictional object
                        per UTC day. /trade offer reserves items for a named
                        buyer for fifteen minutes; accept exchanges points and
                        objects together. Sellers can cancel and buyers can
                        decline. Opting out cancels pending offers and returns
                        reserved items. No trade or game notifications are sent.
                    </p>
                    <button type="submit">Save entertainment approvals</button>
                </fieldset>
            </form>
            {notice && (
                <p role="status" className="bl-form-notice">
                    {notice}
                </p>
            )}
            {error && (
                <p role="alert" className="bl-form-alert">
                    {error}
                </p>
            )}
            {!templates && !error && (
                <p role="status" className="bl-form-notice">
                    Loading entertainment…
                </p>
            )}
            <p>
                Five pending offers per sender or recipient, fifty offers per
                sender a day, one thousand retained offers per server. Completed
                offers expire after thirty days; game receipts after seven days.
            </p>
            {trades?.length === 0 && <p>No retained collection trades.</p>}
            <ul>
                {trades?.map((trade) => (
                    <li
                        key={trade.id}
                        className="border border-bl-border/60 p-3 rounded break-words"
                    >
                        {trade.id}: {trade.quantity} {trade.itemId} ·{' '}
                        {trade.price} points · {trade.state}
                        <p>
                            {trade.sellerId} → {trade.buyerId}
                        </p>
                    </li>
                ))}
            </ul>
        </section>
    );
}
