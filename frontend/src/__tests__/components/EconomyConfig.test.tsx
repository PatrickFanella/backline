import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import EconomyConfig from '../../components/EconomyConfig';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
describe('economy settings', () => {
    it('saves explicit game/shop choices without enabling the module', async () => {
        vi.mocked(api.get).mockResolvedValue({ data: [] });
        vi.mocked(api.put).mockResolvedValue({ data: {} });
        render(
            <EconomyConfig
                guildId="one"
                enabled={false}
                config={{}}
                onSaved={vi.fn().mockResolvedValue(undefined)}
                onBusy={vi.fn()}
            />
        );
        fireEvent.click(screen.getByLabelText('Enable coin games'));
        fireEvent.click(screen.getByText('Save economy settings'));
        expect(
            await screen.findByText('Economy settings saved.')
        ).toBeInTheDocument();
        expect(api.put).toHaveBeenCalledWith('/guilds/one/modules/economy', {
            enabled: false,
            config: {
                currencyName: 'Credits',
                dailyReward: 100,
                gamesEnabled: true,
                shopEnabled: false,
            },
        });
    });
    it('reports a ledger failure without claiming an empty ledger', async () => {
        vi.mocked(api.get).mockRejectedValue(new Error('offline'));
        render(
            <EconomyConfig
                guildId="one"
                enabled={false}
                config={{}}
                onSaved={vi.fn()}
                onBusy={vi.fn()}
            />
        );
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'could not be loaded'
        );
        expect(
            screen.queryByText('No economy entries are recorded.')
        ).not.toBeInTheDocument();
    });
});
