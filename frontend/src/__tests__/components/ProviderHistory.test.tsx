import { render, screen } from '@testing-library/react';
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
});
