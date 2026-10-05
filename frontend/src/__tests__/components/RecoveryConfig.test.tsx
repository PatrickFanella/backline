import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import RecoveryConfig from '../../components/RecoveryConfig';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
describe('snapshot settings', () => {
    it('saves a schedule without enabling the module', async () => {
        vi.mocked(api.get).mockResolvedValue({ data: [] });
        vi.mocked(api.put).mockResolvedValue({ data: {} });
        render(
            <RecoveryConfig
                guildId="guild-one"
                enabled={false}
                config={{}}
                onSaved={vi.fn().mockResolvedValue(undefined)}
                onBusy={vi.fn()}
            />
        );
        fireEvent.click(screen.getByLabelText(/Capture on a schedule/));
        fireEvent.click(screen.getByText('Save snapshot settings'));
        expect(
            await screen.findByText('Snapshot settings saved.')
        ).toBeInTheDocument();
        expect(api.put).toHaveBeenCalledWith(
            '/guilds/guild-one/modules/recovery',
            {
                enabled: false,
                config: {
                    scheduled: true,
                    intervalHours: 24,
                    retainDays: 30,
                    protectedChannelIds: [],
                    protectedRoleIds: [],
                },
            }
        );
    });
    it('does not present an unavailable history as empty', async () => {
        vi.mocked(api.get).mockRejectedValue(new Error('offline'));
        render(
            <RecoveryConfig
                guildId="guild-one"
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
            screen.queryByText('No retained server snapshots.')
        ).not.toBeInTheDocument();
    });
});
