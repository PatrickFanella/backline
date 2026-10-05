import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import RecurringAnnouncementsHistory from '../../components/RecurringAnnouncementsHistory';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({
    default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));
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
    it('reuses its creation request ID after an uncertain save failure', async () => {
        vi.mocked(api.get).mockResolvedValue({ data: [] });
        vi.mocked(api.post).mockClear();
        vi.mocked(api.post)
            .mockRejectedValueOnce(new Error('offline'))
            .mockRejectedValueOnce(new Error('offline again'))
            .mockResolvedValueOnce({ data: {} })
            .mockResolvedValueOnce({ data: {} });
        const user = userEvent.setup();
        render(<RecurringAnnouncementsHistory guildId="guild-one" />);
        await user.type(
            await screen.findByLabelText('Destination channel ID'),
            '777777777777777864'
        );
        await user.type(
            screen.getByLabelText('First local time'),
            '2026-10-06T18:00'
        );
        await user.type(screen.getByLabelText('Message'), 'Retry me');
        await user.click(
            screen.getByRole('button', { name: 'Save recurring announcement' })
        );
        await screen.findByRole('alert');
        await user.click(
            screen.getByRole('button', { name: 'Save recurring announcement' })
        );
        await screen.findByRole('alert');
        await user.type(screen.getByLabelText('Message'), ' changed');
        await user.selectOptions(
            screen.getByLabelText('Repeated local time'),
            'later'
        );
        await user.click(
            screen.getByRole('button', { name: 'Save recurring announcement' })
        );
        await screen.findByText('Recurring announcement saved.');
        await user.click(
            screen.getByRole('button', { name: 'Save recurring announcement' })
        );
        const first = vi.mocked(api.post).mock.calls[0][1] as {
            requestId: string;
        };
        const second = vi.mocked(api.post).mock.calls[1][1] as {
            requestId: string;
        };
        expect(first.requestId).toBe(second.requestId);
        const third = vi.mocked(api.post).mock.calls[2][1] as {
            requestId: string;
            disambiguation: string;
        };
        const fourth = vi.mocked(api.post).mock.calls[3][1] as {
            requestId: string;
        };
        expect(third.requestId).not.toBe(first.requestId);
        expect(third.disambiguation).toBe('later');
        expect(fourth.requestId).not.toBe(third.requestId);
    });
    it('does not reload old guild history when a pending mutation completes', async () => {
        vi.mocked(api.get).mockReset();
        vi.mocked(api.get)
            .mockResolvedValueOnce({
                data: [
                    {
                        id: 'old-series',
                        state: 'PAUSED',
                        cadence: 'weekly',
                        localTime: '2026-10-08T18:00',
                        timeZone: 'UTC',
                        endsAt: '2026-11-08T18:00:00Z',
                    },
                ],
            })
            .mockResolvedValueOnce({ data: [] });
        let finish: () => void = () => undefined;
        vi.mocked(api.patch).mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = () => {
                        resolve({ data: {} });
                    };
                })
        );
        const user = userEvent.setup();
        const view = render(
            <RecurringAnnouncementsHistory guildId="guild-one" />
        );
        await user.click(await screen.findByRole('button', { name: 'Resume' }));
        view.rerender(<RecurringAnnouncementsHistory guildId="guild-two" />);
        await screen.findByText('No recurring announcements are recorded.');
        await act(async () => finish());
        expect(api.get).toHaveBeenCalledTimes(2);
        expect(
            screen.queryByText('Announcement resumed.')
        ).not.toBeInTheDocument();
        expect(screen.queryByText(/old-series/)).not.toBeInTheDocument();
    });
});
