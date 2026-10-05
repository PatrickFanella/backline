import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import RecurringAnnouncementsHistory from '../../components/RecurringAnnouncementsHistory';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn() } }));
describe('recurring announcements', () => {
    it('shows a held series and its cancellation command', async () => {
        vi.mocked(api.get).mockResolvedValue({
            data: [
                {
                    id: 'series-one',
                    state: 'HELD',
                    cadence: 'daily',
                    localTime: '2026-10-06T18:00',
                    timeZone: 'UTC',
                    endsAt: '2026-11-06T18:00:00Z',
                },
            ],
        });
        render(<RecurringAnnouncementsHistory guildId="guild-one" />);
        expect(await screen.findByText(/daily · HELD/)).toBeInTheDocument();
        expect(
            screen.getByText(/Inspect the previous delivery/)
        ).toBeInTheDocument();
        expect(screen.getByText(/series-cancel/)).toBeInTheDocument();
    });
    it('shows an error for an unavailable read', async () => {
        vi.mocked(api.get).mockRejectedValue(new Error('offline'));
        render(<RecurringAnnouncementsHistory guildId="guild-one" />);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'could not be loaded'
        );
    });
});
