import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LevelingConfig from '../../components/LevelingConfig';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
const props = {
    guildId: '777777777777777801',
    enabled: false,
    config: {},
    onSaved: vi.fn().mockResolvedValue(undefined),
    onBusy: vi.fn(),
};
describe('leveling settings and server leaderboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(api.put).mockResolvedValue({ data: { success: true } });
    });
    it('saves voice opt-in, exclusions and a bounded role reward without enabling the module', async () => {
        render(<LevelingConfig {...props} />);
        fireEvent.click(screen.getByLabelText('Enable voice XP'));
        fireEvent.change(
            screen.getByLabelText('Excluded channel IDs, separated by commas'),
            { target: { value: '777777777777777809' } }
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'Add role reward' })
        );
        fireEvent.change(screen.getByLabelText('Reward role ID'), {
            target: { value: '777777777777777804' },
        });
        fireEvent.change(screen.getByLabelText('Required level'), {
            target: { value: '2' },
        });
        fireEvent.click(
            screen.getByRole('button', { name: 'Save leveling settings' })
        );
        await screen.findByText('Leveling settings saved.');
        expect(api.put).toHaveBeenCalledWith(
            `/guilds/${props.guildId}/modules/leveling`,
            {
                enabled: false,
                config: expect.objectContaining({
                    voiceEnabled: true,
                    excludeSolo: true,
                    excludedChannels: ['777777777777777809'],
                    rewards: [{ roleId: '777777777777777804', level: 2 }],
                }),
            }
        );
        await waitFor(() =>
            expect(props.onBusy).toHaveBeenLastCalledWith(false)
        );
    });
    it('renders the selected server leaderboard and handles unavailable data', async () => {
        vi.mocked(api.get)
            .mockResolvedValueOnce({
                data: {
                    leaderboard: [
                        {
                            memberId: '777777777777777803',
                            displayName: 'Fixture member',
                            xp: 100,
                            level: 1,
                        },
                    ],
                },
            })
            .mockRejectedValueOnce(new Error('Unavailable'));
        render(<LevelingConfig {...props} />);
        fireEvent.click(
            screen.getByRole('button', { name: 'View server leaderboard' })
        );
        await screen.findByText(
            'Fixture member (777777777777777803) · level 1 · 100 XP'
        );
        expect(api.get).toHaveBeenCalledWith(
            `/guilds/${props.guildId}/leveling`
        );
        await waitFor(() =>
            expect(
                screen.getByRole('button', { name: 'View server leaderboard' })
            ).toBeEnabled()
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'View server leaderboard' })
        );
        await screen.findByText('Server leaderboard unavailable.');
    });
    it('reports a rejected policy without claiming it was saved', async () => {
        vi.mocked(api.put).mockRejectedValueOnce(new Error('Denied'));
        render(<LevelingConfig {...props} />);
        fireEvent.click(
            screen.getByRole('button', { name: 'Save leveling settings' })
        );
        await screen.findByText(/Settings were not saved/);
        expect(props.onSaved).not.toHaveBeenCalled();
    });
});
