import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import api from '../../lib/api';
import Moderation from '../../pages/Moderation';
import { useGuild } from '../../store/guild';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
function open() {
    render(
        <MemoryRouter>
            <Moderation />
        </MemoryRouter>
    );
}
function fill() {
    fireEvent.change(screen.getByLabelText('Discord user ID'), {
        target: { value: '123456789012345678' },
    });
    fireEvent.change(screen.getByLabelText('Reason'), {
        target: { value: 'fixture' },
    });
}
describe('moderation dashboard', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        useGuild.setState({ guildId: 'A' });
        vi.mocked(api.get).mockResolvedValue({ data: [] });
    });
    it('scopes case history and queued actions to the selected server', async () => {
        vi.mocked(api.post).mockResolvedValue({ data: { id: 'job' } });
        open();
        fill();
        fireEvent.click(screen.getByText('Queue moderation action'));
        await screen.findByText(/Queued\./);
        expect(api.get).toHaveBeenCalledWith('/guilds/A/moderation/cases');
        expect(api.post).toHaveBeenCalledWith(
            '/guilds/A/moderation/actions',
            expect.objectContaining({
                action: {
                    action: 'warn',
                    targetId: '123456789012345678',
                    reason: 'fixture',
                },
            })
        );
        expect(screen.getByLabelText('Reason')).toBeDisabled();
    });
    it('reuses the request key after a lost queue response', async () => {
        vi.mocked(api.post)
            .mockRejectedValueOnce(new Error('lost'))
            .mockResolvedValueOnce({ data: { id: 'job' } });
        open();
        fill();
        fireEvent.click(screen.getByText('Queue moderation action'));
        await screen.findByText(/Queue response unavailable/);
        fireEvent.click(screen.getByText('Retry same request'));
        await screen.findByText(/Queued\./);
        expect(vi.mocked(api.post).mock.calls[0][1]).toEqual(
            vi.mocked(api.post).mock.calls[1][1]
        );
    });
    it('does not unlock uncertain mutations for another submission', async () => {
        vi.mocked(api.post).mockResolvedValue({ data: { id: 'job' } });
        open();
        fill();
        fireEvent.click(screen.getByText('Queue moderation action'));
        await screen.findByText(/Queued\./);
        vi.mocked(api.get).mockImplementation(async (url) => ({
            data: url.includes('/jobs/')
                ? { state: 'RECONCILE', lastError: 'Uncertain' }
                : [],
        }));
        fireEvent.click(screen.getByText('Refresh outcomes'));
        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent('RECONCILE')
        );
        expect(screen.getByLabelText('Reason')).toBeDisabled();
    });
});
