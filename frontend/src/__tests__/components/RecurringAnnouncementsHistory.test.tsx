import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import RecurringAnnouncementsHistory from '../../components/RecurringAnnouncementsHistory';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
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
    it('resumes only a paused series through the automation endpoint', async () => {
        vi.mocked(api.get).mockResolvedValue({
            data: [
                {
                    id: 'series-one',
                    state: 'PAUSED',
                    cadence: 'weekly',
                    localTime: '2026-10-08T18:00',
                    timeZone: 'UTC',
                    endsAt: '2026-11-08T18:00:00Z',
                },
            ],
        });
        vi.mocked(api.patch).mockResolvedValue({ data: { state: 'ACTIVE' } });
        const user = userEvent.setup();
        render(<RecurringAnnouncementsHistory guildId="guild-one" />);
        await user.click(await screen.findByRole('button', { name: 'Resume' }));
        expect(api.patch).toHaveBeenCalledWith(
            '/guilds/guild-one/automation/announcements/series-one',
            { action: 'resume' }
        );
    });
});
