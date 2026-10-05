import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import RestoreHistory from '../../components/RestoreHistory';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn() } }));
describe('restore previews', () => {
    it('shows selected changes, step receipts and exact owner confirmation', async () => {
        vi.mocked(api.get).mockResolvedValue({
            data: [
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
            ],
        });
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
});
