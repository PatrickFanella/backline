import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import ProviderHistory from '../../components/ProviderHistory';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
describe('provider history', () => {
    it('separates established baselines from uncertain delivery', async () => {
        vi.mocked(api.get).mockResolvedValue({
            data: {
                feeds: [
                    {
                        id: 'feed-one',
                        provider: 'twitch',
                        source: 'subcult',
                        enabled: true,
                        baselineAt: '2026-10-04T00:00:00Z',
                        failures: 0,
                        lastError: null,
                    },
                ],
                events: [
                    {
                        id: 'event-one',
                        state: 'UNCERTAIN',
                        delivery: { state: 'RECONCILE' },
                    },
                ],
            },
        });
        render(<ProviderHistory guildId="guild-one" />);
        expect(
            await screen.findByText(/baseline established/)
        ).toBeInTheDocument();
        expect(screen.getByText(/holds uncertain sends/)).toBeInTheDocument();
    });
    it('shows an unavailable read', async () => {
        vi.mocked(api.get).mockRejectedValue(new Error('offline'));
        render(<ProviderHistory guildId="guild-one" />);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'could not be loaded'
        );
    });
    it('pauses a feed through the guarded automation endpoint', async () => {
        vi.mocked(api.get).mockResolvedValue({
            data: {
                feeds: [
                    {
                        id: 'feed-one',
                        provider: 'rss',
                        source: 'https://example.test/feed',
                        enabled: true,
                        baselineAt: null,
                        failures: 0,
                        lastError: null,
                    },
                ],
                events: [],
            },
        });
        vi.mocked(api.patch).mockResolvedValue({ data: { enabled: false } });
        const user = userEvent.setup();
        render(<ProviderHistory guildId="guild-one" />);
        await user.click(await screen.findByRole('button', { name: 'Pause' }));
        expect(api.patch).toHaveBeenCalledWith(
            '/guilds/guild-one/automation/feeds/feed-one',
            { enabled: false }
        );
    });
    it('does not reload the previous guild after a pending mutation completes', async () => {
        vi.mocked(api.get).mockReset();
        vi.mocked(api.get)
            .mockResolvedValueOnce({
                data: {
                    feeds: [
                        {
                            id: 'old-feed',
                            provider: 'rss',
                            source: 'https://example.test/old',
                            enabled: true,
                            baselineAt: null,
                            failures: 0,
                            lastError: null,
                        },
                    ],
                    events: [],
                },
            })
            .mockResolvedValueOnce({ data: { feeds: [], events: [] } });
        let finish: () => void = () => undefined;
        vi.mocked(api.patch).mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = () => resolve({ data: { enabled: false } });
                })
        );
        const user = userEvent.setup();
        const view = render(<ProviderHistory guildId="guild-one" />);
        await user.click(await screen.findByRole('button', { name: 'Pause' }));
        view.rerender(<ProviderHistory guildId="guild-two" />);
        expect(
            await screen.findByText('No provider feeds are configured.')
        ).toBeInTheDocument();
        await act(async () => finish());
        expect(api.get).toHaveBeenCalledTimes(2);
        expect(screen.queryByText('Feed paused.')).not.toBeInTheDocument();
        expect(screen.queryByText(/example.test\/old/)).not.toBeInTheDocument();
    });
});
