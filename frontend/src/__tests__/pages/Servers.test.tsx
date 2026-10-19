import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import api from '../../lib/api';
import Servers from '../../pages/Servers';
import { useGuild } from '../../store/guild';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
vi.mock('../../components/ui/ThemeToggle', () => ({ ThemeToggle: () => null }));
const module = {
    id: 'activity',
    description: 'Observed activity',
    operatorReady: true,
    permissions: [],
    intents: [],
    settings: { enabled: false, config: {} },
};
function open() {
    render(
        <MemoryRouter>
            <Servers />
        </MemoryRouter>
    );
}
describe('server setup', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        useGuild.setState({ guildId: null });
        vi.mocked(api.get).mockImplementation(async (url) => ({
            data:
                url === '/guilds'
                    ? [
                          { id: 'A', name: 'Server A', icon: null },
                          { id: 'B', name: 'Server B', icon: null },
                      ]
                    : [module],
        }));
    });
    it('selects an authorized server and loads its modules', async () => {
        open();
        await screen.findByRole('button', { name: 'Enable' });
        expect(api.get).toHaveBeenCalledWith('/guilds/A/modules');
        fireEvent.change(screen.getByLabelText('Server'), {
            target: { value: 'B' },
        });
        await waitFor(() =>
            expect(api.get).toHaveBeenCalledWith('/guilds/B/modules')
        );
    });
    it('saves to the selected server and confirms persisted state', async () => {
        vi.mocked(api.put).mockImplementation(async () => {
            vi.mocked(api.get).mockResolvedValue({
                data: [{ ...module, settings: { enabled: true, config: {} } }],
            });
            return { data: { success: true } };
        });
        open();
        fireEvent.click(await screen.findByRole('button', { name: 'Enable' }));
        await screen.findByText('Settings saved for this server.');
        expect(api.put).toHaveBeenCalledWith('/guilds/A/modules/activity', {
            enabled: true,
            config: {},
        });
        expect(screen.getByRole('button', { name: 'Disable' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
    });
    it('keeps settings unchanged when authorization is revoked', async () => {
        vi.mocked(api.put).mockRejectedValue(new Error('Forbidden'));
        open();
        fireEvent.click(await screen.findByRole('button', { name: 'Enable' }));
        await screen.findByRole('alert');
        expect(screen.getByRole('button', { name: 'Enable' })).toHaveAttribute(
            'aria-pressed',
            'false'
        );
    });
    it('shows why no manageable server is available', async () => {
        vi.mocked(api.get).mockResolvedValue({ data: [] });
        open();
        await screen.findByText('No manageable servers found');
        expect(screen.queryByLabelText('Server')).not.toBeInTheDocument();
    });
    it('disables enabling a module with missing operator intents', async () => {
        vi.mocked(api.get).mockImplementation(async (url) => ({
            data:
                url === '/guilds'
                    ? [{ id: 'A', name: 'Server A', icon: null }]
                    : [{ ...module, operatorReady: false }],
        }));
        open();
        expect(
            await screen.findByRole('button', { name: 'Enable' })
        ).toBeDisabled();
        expect(screen.getByText(/needs the operator/)).toBeInTheDocument();
    });
    it('links each module to its settings page', async () => {
        open();
        expect(
            await screen.findByRole('link', { name: 'View Activity reports' })
        ).toHaveAttribute('href', '/servers/modules/activity');
    });
});
