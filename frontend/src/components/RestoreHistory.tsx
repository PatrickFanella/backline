import {
    useCallback,
    useEffect,
    useMemo,
    useState,
    type FormEvent,
} from 'react';

import api from '../lib/api';

type Operation = {
    kind: string;
    sourceId: string;
    targetId: string | null;
    action: string;
    selected: boolean;
    status: string;
    reason: string;
    before?: unknown;
    after?: unknown;
};
type Plan = {
    id: string;
    snapshotId: string;
    state: string;
    expiresAt: string;
    lastError: string | null;
    operations: Operation[];
};
type Snapshot = { id: string; kind: string; expiresAt: string };
type SnapshotResource = { id: string; name: string };
type SnapshotExport = {
    manifest: {
        roles: SnapshotResource[];
        channels: SnapshotResource[];
    };
};
export default function RestoreHistory({ guildId }: { guildId: string }) {
    const [plans, setPlans] = useState<Plan[] | null>(null),
        [snapshots, setSnapshots] = useState<Snapshot[]>([]),
        [error, setError] = useState(''),
        [notice, setNotice] = useState(''),
        [busy, setBusy] = useState(false),
        [snapshotId, setSnapshotId] = useState(''),
        [snapshotExport, setSnapshotExport] = useState<SnapshotExport | null>(
            null
        ),
        [snapshotExportError, setSnapshotExportError] = useState(''),
        [picked, setPicked] = useState<string[]>([]),
        [selected, setSelected] = useState(''),
        [mapKind, setMapKind] = useState('role'),
        [sourceId, setSourceId] = useState(''),
        [targetId, setTargetId] = useState(''),
        [confirmations, setConfirmations] = useState<Record<string, string>>(
            {}
        );
    const manualResources = useMemo(
        () => selected.split(/[\s,]+/).filter(Boolean),
        [selected]
    );
    const resources = useMemo(
        () => [...new Set([...picked, ...manualResources])],
        [picked, manualResources]
    );
    const load = useCallback(
        async (current: () => boolean = () => true) => {
            const [plansResponse, snapshotsResponse] = await Promise.all([
                api.get<Plan[]>(`/guilds/${guildId}/modules/recovery/plans`),
                api.get<Snapshot[]>(
                    `/guilds/${guildId}/modules/recovery/snapshots`
                ),
            ]);
            if (!current()) return;
            setPlans(plansResponse.data);
            setSnapshots(snapshotsResponse.data);
        },
        [guildId]
    );
    useEffect(() => {
        let active = true;
        setSnapshotId('');
        setPicked([]);
        setSelected('');
        setSnapshotExport(null);
        setSnapshotExportError('');
        load(() => active).catch(() => {
            if (active) setError('Restore previews could not be loaded.');
        });
        return () => {
            active = false;
        };
    }, [guildId, load]);
    useEffect(() => {
        let active = true;
        setPicked([]);
        setSnapshotExport(null);
        setSnapshotExportError('');
        if (!snapshotId)
            return () => {
                active = false;
            };
        api.get<SnapshotExport>(
            `/guilds/${guildId}/modules/recovery/snapshots/${snapshotId}/export`
        )
            .then((response) => {
                if (active) setSnapshotExport(response.data);
            })
            .catch(() => {
                if (active)
                    setSnapshotExportError(
                        'Snapshot resource names could not be loaded. You can still enter verified resource IDs manually.'
                    );
            });
        return () => {
            active = false;
        };
    }, [guildId, snapshotId]);
    async function action(message: string, request: () => Promise<unknown>) {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            await request();
            await load();
            setNotice(message);
        } catch {
            setError(
                'Restore request was not queued. Check current server access and the selected values.'
            );
        } finally {
            setBusy(false);
        }
    }
    function preview(event: FormEvent) {
        event.preventDefault();
        if (!resources.length || resources.length > 20) {
            setError('Select one to twenty snapshot resources.');
            return;
        }
        void action(
            'Restore preview queued. It will appear after the worker checks the current server structure.',
            () =>
                api.post(`/guilds/${guildId}/modules/recovery/previews`, {
                    snapshotId,
                    selected: resources,
                })
        );
    }
    function togglePicked(id: string, checked: boolean) {
        setPicked((current) => {
            if (!checked) return current.filter((value) => value !== id);
            if (current.includes(id) || resources.length >= 20) return current;
            return [...current, id];
        });
    }
    function map(event: FormEvent) {
        event.preventDefault();
        void action('Restore mapping queued for owner verification.', () =>
            api.post(`/guilds/${guildId}/modules/recovery/mappings`, {
                kind: mapKind,
                sourceId,
                targetId,
            })
        );
    }
    async function download(plan: Plan) {
        try {
            const response = await api.get(
                `/guilds/${guildId}/modules/recovery/plans/${plan.id}/export`,
                { responseType: 'blob' }
            );
            const url = URL.createObjectURL(response.data);
            try {
                const link = document.createElement('a');
                link.href = url;
                link.download = `backline-${guildId}-restore-${plan.id}.json`;
                link.click();
            } finally {
                URL.revokeObjectURL(url);
            }
        } catch {
            setError('Restore plan export could not be loaded.');
        }
    }
    return (
        <section aria-label="Selective restore previews" className="space-y-3">
            <p>
                Select a retained snapshot and up to twenty resource IDs to
                queue a comparison. Select parent categories and ordinary roles
                with their dependent channels. A restore only creates or updates
                selected resources; it never deletes resources.
            </p>
            <form
                onSubmit={preview}
                className="space-y-2 border border-bl-surface rounded p-3"
            >
                <fieldset className="space-y-2">
                    <legend>Create restore preview</legend>
                    <label className="bl-label">
                        Snapshot
                        <select
                            required
                            value={snapshotId}
                            onChange={(event) =>
                                setSnapshotId(event.target.value)
                            }
                            className="bl-input"
                        >
                            <option value="">Select snapshot</option>
                            {snapshots.map((snapshot) => (
                                <option key={snapshot.id} value={snapshot.id}>
                                    {snapshot.kind} · {snapshot.id}
                                </option>
                            ))}
                        </select>
                    </label>
                    {snapshotExport && (
                        <fieldset className="space-y-2">
                            <legend>
                                Pick snapshot roles and channels (up to twenty)
                            </legend>
                            <p className="text-sm text-bl-muted">
                                {resources.length} of 20 selected. Names come
                                from this retained snapshot.
                            </p>
                            {(['roles', 'channels'] as const).map((kind) => (
                                <div key={kind}>
                                    <h4 className="font-medium capitalize">
                                        {kind}
                                    </h4>
                                    {snapshotExport.manifest[kind].length ===
                                    0 ? (
                                        <p>No {kind} in this snapshot.</p>
                                    ) : (
                                        snapshotExport.manifest[kind].map(
                                            (resource) => {
                                                const isPicked =
                                                    picked.includes(
                                                        resource.id
                                                    );
                                                return (
                                                    <label
                                                        className="block"
                                                        key={resource.id}
                                                    >
                                                        <input
                                                            checked={isPicked}
                                                            disabled={
                                                                !isPicked &&
                                                                resources.length >=
                                                                    20
                                                            }
                                                            onChange={(event) =>
                                                                togglePicked(
                                                                    resource.id,
                                                                    event.target
                                                                        .checked
                                                                )
                                                            }
                                                            type="checkbox"
                                                        />{' '}
                                                        {resource.name} (
                                                        {resource.id})
                                                    </label>
                                                );
                                            }
                                        )
                                    )}
                                </div>
                            ))}
                        </fieldset>
                    )}
                    {snapshotExportError && (
                        <p role="status" className="bl-form-notice">
                            {snapshotExportError}
                        </p>
                    )}
                    <label className="bl-label">
                        Advanced resource IDs (optional; up to 20 total, comma
                        or space separated)
                        <textarea
                            value={selected}
                            onChange={(event) =>
                                setSelected(event.target.value)
                            }
                            className="bl-input"
                        />
                    </label>
                    <button
                        disabled={
                            busy || !resources.length || resources.length > 20
                        }
                        type="submit"
                    >
                        Queue preview
                    </button>
                </fieldset>
            </form>
            <form
                onSubmit={map}
                className="space-y-2 border border-bl-surface rounded p-3"
            >
                <fieldset className="space-y-2">
                    <legend>Map verified resource</legend>
                    <label className="bl-label">
                        Kind
                        <select
                            value={mapKind}
                            onChange={(event) => setMapKind(event.target.value)}
                            className="bl-input"
                        >
                            <option value="role">Role</option>
                            <option value="channel">Channel</option>
                        </select>
                    </label>
                    <label className="bl-label">
                        Original resource ID
                        <input
                            required
                            pattern="[0-9]{17,20}"
                            value={sourceId}
                            onChange={(event) =>
                                setSourceId(event.target.value)
                            }
                            className="bl-input"
                        />
                    </label>
                    <label className="bl-label">
                        Verified current resource ID
                        <input
                            required
                            pattern="[0-9]{17,20}"
                            value={targetId}
                            onChange={(event) =>
                                setTargetId(event.target.value)
                            }
                            className="bl-input"
                        />
                    </label>
                    <button disabled={busy} type="submit">
                        Queue mapping
                    </button>
                </fieldset>
            </form>
            {notice && (
                <p role="status" className="bl-form-notice">
                    {notice}
                </p>
            )}
            <p>
                Review the result, then the current server owner enters the
                exact confirmation in the plan form to queue an apply. Everyone,
                managed, privileged, above-bot and protected roles are skipped.
                Unsupported and protected channels are skipped. Bot access is
                maintained. Absolute positions and member accounts are outside
                the restore.
            </p>
            <p>
                For an uncertain creation, inspect Discord, enter the original
                and verified current IDs in the mapping form, then create a
                fresh preview. Uncertain steps cannot replay automatically. A
                confirmed rejection pauses the plan until another owner
                confirmation is submitted.
            </p>
            {error && (
                <p role="alert" className="bl-form-alert">
                    {error}
                </p>
            )}
            {!error && !plans && (
                <p role="status" className="bl-form-notice">
                    Loading restore previews…
                </p>
            )}
            {plans && !plans.length && <p>No restore previews are recorded.</p>}
            <ul className="space-y-3">
                {plans?.map((plan) => (
                    <li
                        key={plan.id}
                        className="border border-bl-surface rounded p-3 break-words"
                    >
                        <p>
                            Plan {plan.id}: {plan.state}
                        </p>
                        <p>
                            Expires {new Date(plan.expiresAt).toLocaleString()}{' '}
                            · deletions: 0
                        </p>
                        {plan.lastError && <p>{plan.lastError}</p>}
                        <p className="break-all">
                            Owner confirmation: RESTORE {guildId} {plan.id}
                        </p>
                        <button
                            type="button"
                            onClick={() => {
                                void download(plan);
                            }}
                        >
                            Download full plan
                        </button>
                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                const requestId = crypto.randomUUID();
                                void action(
                                    'Owner-confirmed restore apply request queued.',
                                    () =>
                                        api.post(
                                            `/guilds/${guildId}/modules/recovery/plans/${plan.id}/apply`,
                                            {
                                                confirmation:
                                                    confirmations[plan.id] ??
                                                    '',
                                                requestId,
                                            }
                                        )
                                );
                            }}
                            className="space-y-2 mt-2"
                        >
                            <fieldset className="space-y-2">
                                <legend>Owner confirmation</legend>
                                <label className="bl-label">
                                    Owner confirmation
                                    <input
                                        required
                                        value={confirmations[plan.id] ?? ''}
                                        onChange={(event) =>
                                            setConfirmations({
                                                ...confirmations,
                                                [plan.id]: event.target.value,
                                            })
                                        }
                                        className="bl-input"
                                        placeholder={`RESTORE ${guildId} ${plan.id}`}
                                    />
                                </label>
                                <button
                                    disabled={
                                        busy ||
                                        (plan.state !== 'PREVIEW' &&
                                            plan.state !== 'PAUSED')
                                    }
                                    type="submit"
                                >
                                    Queue owner-confirmed apply
                                </button>
                            </fieldset>
                        </form>
                        <table className="w-full text-sm">
                            <thead>
                                <tr>
                                    <th>Resource</th>
                                    <th>Change</th>
                                    <th>Selected</th>
                                    <th>Receipt</th>
                                </tr>
                            </thead>
                            <tbody>
                                {plan.operations
                                    .filter((op) => op.selected)
                                    .map((op) => (
                                        <tr key={op.kind + op.sourceId}>
                                            <td className="break-all">
                                                {op.kind} {op.sourceId}
                                                <br />
                                                Target:{' '}
                                                {op.targetId ?? 'unmapped'}
                                            </td>
                                            <td>
                                                {op.action}
                                                <br />
                                                {op.reason}
                                                <details>
                                                    <summary>
                                                        Review fields
                                                    </summary>
                                                    <pre className="overflow-auto max-w-full whitespace-pre-wrap break-words">
                                                        {JSON.stringify(
                                                            {
                                                                before: op.before,
                                                                after: op.after,
                                                            },
                                                            null,
                                                            2
                                                        )}
                                                    </pre>
                                                </details>
                                            </td>
                                            <td>Yes</td>
                                            <td>{op.status}</td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>
                        <p>
                            {
                                plan.operations.filter((op) => !op.selected)
                                    .length
                            }{' '}
                            resources are outside the selection. Download the
                            plan to review every creation, update, unchanged and
                            skipped resource.
                        </p>
                    </li>
                ))}
            </ul>
        </section>
    );
}
