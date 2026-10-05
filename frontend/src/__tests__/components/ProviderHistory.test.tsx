import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ProviderHistory from '../../components/ProviderHistory';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn() } }));
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
});
