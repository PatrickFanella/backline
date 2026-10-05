import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GiveawayConfig from '../../components/GiveawayConfig';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({
    default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));
const props = {
    guildId: '777777777777777781',
    enabled: true,
    config: {},
    onBusy: vi.fn(),
    onSaved: vi.fn().mockResolvedValue(undefined),
};
describe('giveaway dashboard actions', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(api.get).mockResolvedValue({ data: [] });
    });
    it('queues creation and distinguishes it from confirmed delivery', async () => {
        vi.mocked(api.post).mockResolvedValue({ data: { id: 'queued-job' } });
        render(<GiveawayConfig {...props} />);
        fireEvent.change(screen.getByLabelText('Announcement channel ID'), {
            target: { value: '777777777777777783' },
        });
        fireEvent.change(screen.getByLabelText('Prize'), {
            target: { value: 'Fixture prize' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Queue giveaway' }));
        expect(
            await screen.findByText(
                'Creation queued. Check the action result to confirm delivery.'
            )
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Queue giveaway' })
        ).toBeDisabled();
        expect(api.post).toHaveBeenCalledWith(
            `/guilds/${props.guildId}/giveaways`,
            expect.objectContaining({
                prize: 'Fixture prize',
                channelId: '777777777777777783',
                requestId: expect.any(String),
            })
        );
        vi.mocked(api.get).mockImplementation(async (url) => ({
            data: url.endsWith('/jobs/queued-job')
                ? { state: 'DELIVERED', lastError: null }
                : [],
        }));
        fireEvent.click(
            screen.getByRole('button', { name: 'Check action result' })
        );
        expect(
            await screen.findByText('Action: DELIVERED')
        ).toBeInTheDocument();
        await waitFor(() =>
            expect(
                screen.getByRole('button', { name: 'Queue giveaway' })
            ).toBeEnabled()
        );
    });
    it('keeps creation disabled until the module is enabled', async () => {
        render(<GiveawayConfig {...props} enabled={false} />);
        expect(
            screen.getByRole('button', { name: 'Queue giveaway' })
        ).toBeDisabled();
        expect(api.post).not.toHaveBeenCalled();
        await waitFor(() =>
            expect(api.get).toHaveBeenCalledWith(
                `/guilds/${props.guildId}/giveaways`
            )
        );
    });
    it('preserves the queued action when its outcome is uncertain', async () => {
        vi.mocked(api.post).mockResolvedValue({ data: { id: 'held-job' } });
        render(<GiveawayConfig {...props} />);
        fireEvent.change(screen.getByLabelText('Announcement channel ID'), {
            target: { value: '777777777777777783' },
        });
        fireEvent.change(screen.getByLabelText('Prize'), {
            target: { value: 'Fixture prize' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Queue giveaway' }));
        await screen.findByRole('button', { name: 'Check action result' });
        vi.mocked(api.get).mockImplementation(async (url) => ({
            data: url.endsWith('/jobs/held-job')
                ? { state: 'RECONCILE', lastError: 'Outcome uncertain' }
                : [],
        }));
        fireEvent.click(
            screen.getByRole('button', { name: 'Check action result' })
        );
        expect(
            await screen.findByText('Action: RECONCILE — Outcome uncertain')
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Queue giveaway' })
        ).toBeDisabled();
    });
});
