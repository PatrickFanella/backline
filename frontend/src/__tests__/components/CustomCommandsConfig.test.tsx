import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CustomCommandsConfig from '../../components/CustomCommandsConfig';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { put: vi.fn() } }));
const props = {
    guildId: '777777777777777841',
    enabled: false,
    config: {},
    onSaved: vi.fn().mockResolvedValue(undefined),
    onBusy: vi.fn(),
};
describe('custom reply configuration', () => {
    beforeEach(() => vi.clearAllMocks());
    it('saves a role-scoped text/embed reply without enabling the module', async () => {
        vi.mocked(api.put).mockResolvedValue({ data: { success: true } });
        render(<CustomCommandsConfig {...props} />);
        fireEvent.click(
            screen.getByRole('button', { name: 'Add custom command' })
        );
        fireEvent.change(screen.getByLabelText('Command name'), {
            target: { value: 'rules' },
        });
        fireEvent.change(screen.getByLabelText('Text reply'), {
            target: { value: 'Hello {user}' },
        });
        fireEvent.change(screen.getByLabelText('Embed title'), {
            target: { value: 'Rules' },
        });
        fireEvent.change(
            screen.getByLabelText('Required role IDs, separated by commas'),
            { target: { value: '777777777777777844' } }
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'Save custom commands' })
        );
        await screen.findByText('Custom commands saved.');
        expect(api.put).toHaveBeenCalledWith(
            `/guilds/${props.guildId}/modules/custom-commands`,
            {
                enabled: false,
                config: {
                    commands: [
                        {
                            name: 'rules',
                            response: {
                                content: 'Hello {user}',
                                title: 'Rules',
                                description: '',
                            },
                            requiredRoles: ['777777777777777844'],
                        },
                    ],
                },
            }
        );
    });
    it('removes a saved command before submitting the new policy', async () => {
        vi.mocked(api.put).mockResolvedValue({ data: {} });
        render(
            <CustomCommandsConfig
                {...props}
                config={{
                    commands: [
                        {
                            name: 'old',
                            response: {
                                content: 'Old reply',
                                title: '',
                                description: '',
                            },
                            requiredRoles: [],
                        },
                    ],
                }}
            />
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'Remove command 1' })
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'Save custom commands' })
        );
        await screen.findByText('Custom commands saved.');
        expect(api.put).toHaveBeenCalledWith(expect.any(String), {
            enabled: false,
            config: { commands: [] },
        });
    });
    it('reports a rejected save without claiming success', async () => {
        vi.mocked(api.put).mockRejectedValue(new Error('Invalid template'));
        render(<CustomCommandsConfig {...props} />);
        fireEvent.click(
            screen.getByRole('button', { name: 'Save custom commands' })
        );
        await screen.findByText(/Commands were not saved/);
        expect(props.onSaved).not.toHaveBeenCalled();
    });
});
