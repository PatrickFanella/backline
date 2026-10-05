import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ScheduledUtilitiesHistory from '../../components/ScheduledUtilitiesHistory';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn() } }));
describe('scheduled utility history', () => {
    beforeEach(() => {
        vi.mocked(api.get).mockReset();
    });
    it('shows separate pending and uncertain delivery states', async () => {
        vi.mocked(api.get).mockResolvedValue({
            data: [
                {
                    id: 'one',
                    kind: 'ANNOUNCEMENT',
                    runAt: '2026-10-06T18:00:00Z',
                    timeZone: 'UTC',
                    state: 'PENDING',
                    delivery: { state: 'PENDING', lastError: null },
                },
                {
                    id: 'two',
                    kind: 'REMINDER',
                    runAt: '2026-10-06T18:00:00Z',
                    timeZone: 'UTC',
                    state: 'UNCERTAIN',
                    delivery: { state: 'RECONCILE', lastError: 'uncertain' },
                },
            ],
        });
        render(<ScheduledUtilitiesHistory guildId="guild-one" />);
        expect(
            await screen.findByText('Schedule: PENDING; delivery: PENDING')
        ).toBeInTheDocument();
        expect(
            screen.getByText('Schedule: UNCERTAIN; delivery: RECONCILE')
        ).toBeInTheDocument();
        expect(screen.getByText(/Delivery is uncertain/)).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith(
            '/guilds/guild-one/modules/scheduled-utilities/history'
        );
    });
    it('shows an empty state after a successful read', async () => {
        vi.mocked(api.get).mockResolvedValue({ data: [] });
        render(<ScheduledUtilitiesHistory guildId="guild-one" />);
        expect(
            await screen.findByText(/No scheduled announcements/)
        ).toBeInTheDocument();
    });
    it('does not present a failed read as an empty schedule', async () => {
        vi.mocked(api.get).mockRejectedValue(new Error('offline'));
        render(<ScheduledUtilitiesHistory guildId="guild-one" />);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'could not be loaded'
        );
        expect(
            screen.queryByText(/No scheduled announcements/)
        ).not.toBeInTheDocument();
    });
});
