import { useEffect, useState } from 'react';

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
export default function RestoreHistory({ guildId }: { guildId: string }) {
    const [plans, setPlans] = useState<Plan[] | null>(null),
        [error, setError] = useState('');
    useEffect(() => {
        let active = true;
        api.get<Plan[]>(`/guilds/${guildId}/modules/recovery/plans`)
            .then((response) => {
                if (active) setPlans(response.data);
            })
            .catch(() => {
                if (active) setError('Restore previews could not be loaded.');
            });
        return () => {
            active = false;
        };
    }, [guildId]);
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
                Use /restore preview snapshot:ID for comparison, or add
                resources:ID,ID to select up to twenty roles/channels. Select
                missing parent categories and ordinary roles along with their
                dependent channels. This restore creates or updates selected
                resources and performs zero deletions.
            </p>
            <p>
                The server owner must review the plan and use /restore apply
                id:ID confirm:"RESTORE SERVER_ID PREVIEW_ID" before the preview
                expires. Everyone, managed, privileged, above-bot and protected
                roles are skipped. Unsupported/protected channels are skipped.
                Bot access is maintained. Absolute positions and member accounts
                are outside the restore.
            </p>
            <p>
                For an uncertain creation, inspect Discord and use /restore map
                to link the original ID to its verified current resource, then
                generate a fresh preview. Uncertain steps cannot replay
                automatically. Confirmed 4xx rejection pauses the plan and can
                be resumed with another owner confirmation.
            </p>
            {error && <p role="alert">{error}</p>}
            {!error && !plans && <p role="status">Loading restore previews…</p>}
            {plans && !plans.length && <p>No restore previews are recorded.</p>}
            <ul className="space-y-3">
                {plans?.map((plan) => (
                    <li
                        key={plan.id}
                        className="border border-ctp-surface1 rounded p-3 break-words"
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
