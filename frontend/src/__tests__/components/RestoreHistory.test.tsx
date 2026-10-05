import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import RestoreHistory from '../../components/RestoreHistory';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const snapshotId = '11111111-1111-4111-8111-111111111111';
const snapshot = {
    id: snapshotId,
    kind: 'MANUAL',
    expiresAt: '2026-10-06T00:00:00Z',
};
const manifest = {
    manifest: {
        roles: [{ id: '777777777777777861', name: 'Community member' }],
        channels: [{ id: '777777777777777862', name: 'general' }],
    },
};
function historyResponses(plans: unknown[] = [], snapshots = [snapshot]) {
    vi.mocked(api.get).mockImplementation((url: string) => {
        if (url.endsWith('/plans')) return Promise.resolve({ data: plans });
        if (url.endsWith('/snapshots'))
            return Promise.resolve({ data: snapshots });
        if (url.endsWith(`/snapshots/${snapshotId}/export`))
            return Promise.resolve({ data: manifest });
        return Promise.reject(new Error(`Unexpected URL ${url}`));
    });
}

describe('restore previews', () => {
    it('shows selected changes, step receipts and exact owner confirmation', async () => {
        historyResponses([
            {
                id: 'preview-one',
                snapshotId: 'snapshot-one',
                state: 'HELD',
                expiresAt: '2026-10-05T04:00:00Z',
                lastError: 'Creation requires inspection',
                operations: [
                    {
                        kind: 'role',
                        sourceId: 'original-role',
                        targetId: null,
                        action: 'CREATE',
                        selected: true,
                        status: 'HELD',
                        reason: '',
                    },
                    {
                        kind: 'channel',
                        sourceId: 'other-channel',
                        targetId: null,
                        action: 'SKIP',
                        selected: false,
                        status: 'READY',
                        reason: 'Protected',
                    },
                ],
            },
        ]);
        render(<RestoreHistory guildId="guild-one" />);
        expect(
            await screen.findByText('Plan preview-one: HELD')
        ).toBeInTheDocument();
        expect(
            screen.getByText(
                'Owner confirmation: RESTORE guild-one preview-one'
            )
        ).toBeInTheDocument();
        expect(screen.getByText('CREATE')).toBeInTheDocument();
        expect(screen.getByText(/1 resources are outside/)).toBeInTheDocument();
    });

    it('shows an unavailable read rather than an empty preview', async () => {
        vi.mocked(api.get).mockRejectedValue(new Error('offline'));
        render(<RestoreHistory guildId="guild-one" />);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'could not be loaded'
        );
    });

    it('uses authenticated snapshot names for a checkbox preview and preserves manual IDs', async () => {
        historyResponses();
        vi.mocked(api.post).mockResolvedValue({ data: { jobId: 'job-one' } });
        const user = userEvent.setup();
        render(<RestoreHistory guildId="guild-one" />);
        await user.selectOptions(
            await screen.findByLabelText('Snapshot'),
            snapshotId
        );
        const role = await screen.findByLabelText(
            'Community member (777777777777777861)'
        );
        await user.click(role);
        await user.type(
            screen.getByLabelText(/Advanced resource IDs/),
            '777777777777777863'
        );
        await user.click(screen.getByRole('button', { name: 'Queue preview' }));
        expect(api.post).toHaveBeenCalledWith(
            '/guilds/guild-one/modules/recovery/previews',
            {
                snapshotId,
                selected: ['777777777777777861', '777777777777777863'],
            }
        );
        expect(api.get).toHaveBeenCalledWith(
            `/guilds/guild-one/modules/recovery/snapshots/${snapshotId}/export`
        );
    });

    it('does not let a stale snapshot export overwrite a later selection', async () => {
        let resolveFirst:
            | ((value: { data: typeof manifest }) => void)
            | undefined;
        let resolveSecond:
            | ((value: { data: typeof manifest }) => void)
            | undefined;
        const secondId = '22222222-2222-4222-8222-222222222222';
        vi.mocked(api.get).mockImplementation((url: string) => {
            if (url.endsWith('/plans')) return Promise.resolve({ data: [] });
            if (url.endsWith('/snapshots'))
                return Promise.resolve({
                    data: [
                        snapshot,
                        { ...snapshot, id: secondId, kind: 'SCHEDULED' },
                    ],
                });
            if (url.endsWith(`/snapshots/${snapshotId}/export`))
                return new Promise((resolve) => {
                    resolveFirst = resolve;
                });
            if (url.endsWith(`/snapshots/${secondId}/export`))
                return new Promise((resolve) => {
                    resolveSecond = resolve;
                });
            return Promise.reject(new Error(`Unexpected URL ${url}`));
        });
        render(<RestoreHistory guildId="guild-one" />);
        const select = await screen.findByLabelText('Snapshot');
        fireEvent.change(select, { target: { value: snapshotId } });
        fireEvent.change(select, { target: { value: secondId } });
        resolveSecond?.({
            data: {
                manifest: {
                    roles: [],
                    channels: [
                        { id: '777777777777777864', name: 'Later channel' },
                    ],
                },
            },
        });
        expect(await screen.findByText(/Later channel/)).toBeInTheDocument();
        resolveFirst?.({ data: manifest });
        await waitFor(() =>
            expect(
                screen.queryByText(/Community member/)
            ).not.toBeInTheDocument()
        );
    });

    it('does not let stale guild history replace the current guild snapshot options', async () => {
        let resolveOldPlans: ((value: { data: [] }) => void) | undefined;
        let resolveOldSnapshots:
            | ((value: { data: [typeof snapshot] }) => void)
            | undefined;
        const currentSnapshot = {
            ...snapshot,
            id: '33333333-3333-4333-8333-333333333333',
            kind: 'CURRENT',
        };
        vi.mocked(api.get).mockImplementation((url: string) => {
            if (url.includes('/guild-old/') && url.endsWith('/plans'))
                return new Promise((resolve) => {
                    resolveOldPlans = resolve;
                });
            if (url.includes('/guild-old/') && url.endsWith('/snapshots'))
                return new Promise((resolve) => {
                    resolveOldSnapshots = resolve;
                });
            if (url.includes('/guild-current/') && url.endsWith('/plans'))
                return Promise.resolve({ data: [] });
            if (url.includes('/guild-current/') && url.endsWith('/snapshots'))
                return Promise.resolve({ data: [currentSnapshot] });
            return Promise.reject(new Error(`Unexpected URL ${url}`));
        });
        const view = render(<RestoreHistory guildId="guild-old" />);
        view.rerender(<RestoreHistory guildId="guild-current" />);
        expect(
            await screen.findByRole('option', {
                name: `CURRENT · ${currentSnapshot.id}`,
            })
        ).toBeInTheDocument();

        resolveOldPlans?.({ data: [] });
        resolveOldSnapshots?.({ data: [snapshot] });
        await waitFor(() =>
            expect(
                screen.queryByRole('option', {
                    name: `MANUAL · ${snapshotId}`,
                })
            ).not.toBeInTheDocument()
        );
    });

    it('limits named snapshot selection to twenty resources', async () => {
        const roles = Array.from({ length: 21 }, (_, index) => ({
            id: `7000000000000000${String(index + 1).padStart(2, '0')}`,
            name: `Role ${index + 1}`,
        }));
        vi.mocked(api.get).mockImplementation((url: string) => {
            if (url.endsWith('/plans')) return Promise.resolve({ data: [] });
            if (url.endsWith('/snapshots'))
                return Promise.resolve({ data: [snapshot] });
            if (url.endsWith(`/snapshots/${snapshotId}/export`))
                return Promise.resolve({
                    data: { manifest: { roles, channels: [] } },
                });
            return Promise.reject(new Error(`Unexpected URL ${url}`));
        });
        render(<RestoreHistory guildId="guild-one" />);
        fireEvent.change(await screen.findByLabelText('Snapshot'), {
            target: { value: snapshotId },
        });
        await screen.findByLabelText(`Role 1 (${roles[0].id})`);
        for (const role of roles.slice(0, 20))
            fireEvent.click(screen.getByLabelText(`${role.name} (${role.id})`));

        expect(
            screen.getByText(
                '20 of 20 selected. Names come from this retained snapshot.'
            )
        ).toBeInTheDocument();
        expect(
            screen.getByLabelText(`Role 21 (${roles[20].id})`)
        ).toBeDisabled();
    });

    it('uses fieldset legends and remains accessible with the snapshot picker', async () => {
        historyResponses();
        const { container } = render(<RestoreHistory guildId="guild-one" />);
        await screen.findByLabelText('Snapshot');
        expect(
            screen.getByRole('group', { name: 'Create restore preview' })
        ).toBeInTheDocument();
        expect(
            screen.getByRole('group', { name: 'Map verified resource' })
        ).toBeInTheDocument();
        expect((await axe(container)).violations).toEqual([]);
    });
});
