import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import api from '../../lib/api';
import ModulePage from '../../pages/ModulePage';
import { useGuild } from '../../store/guild';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
const module = {
    id: 'activity',
    description: 'Observed activity',
    operatorReady: true,
    permissions: [],
    intents: [],
    settings: { enabled: false, config: {} },
};
function open(moduleId = 'activity') {
    render(
        <MemoryRouter initialEntries={[`/servers/modules/${moduleId}`]}>
            <Routes>
                <Route
                    path="/servers/modules/:moduleId"
                    element={<ModulePage />}
                />
            </Routes>
        </MemoryRouter>
    );
}
describe('module settings page', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        useGuild.setState({ guildId: null });
        vi.mocked(api.get).mockImplementation(async (url) => ({
            data:
                url === '/guilds'
                    ? [{ id: 'A', name: 'Server A', icon: null }]
                    : [module],
        }));
    });
    it('shows the module and toggles it for the selected server', async () => {
        vi.mocked(api.put).mockImplementation(async () => {
            vi.mocked(api.get).mockResolvedValue({
                data: [{ ...module, settings: { enabled: true, config: {} } }],
            });
            return { data: { success: true } };
        });
        open();
        await screen.findByRole('heading', {
            name: 'Activity reports',
            level: 1,
        });
        expect(screen.getByText('No dashboard settings')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
        await screen.findByText('Settings saved for this server.');
        expect(api.put).toHaveBeenCalledWith('/guilds/A/modules/activity', {
            enabled: true,
            config: {},
        });
    });
    it('explains an unknown module', async () => {
        open('not-a-module');
        await screen.findByText('Module not found');
    });
    it('saves audit destination and retention without enabling the module', async () => {
        const audit = {
            ...module,
            id: 'audit-log',
            description: 'Audit events',
        };
        vi.mocked(api.get).mockImplementation(async (url) => ({
            data:
                url === '/guilds'
                    ? [{ id: 'A', name: 'Server A', icon: null }]
                    : [audit],
        }));
        open('audit-log');
        fireEvent.change(await screen.findByLabelText('Log channel ID'), {
            target: { value: '333333333333333333' },
        });
        fireEvent.change(screen.getByLabelText('Keep records for (days)'), {
            target: { value: '3' },
        });
        fireEvent.click(screen.getByText('Save log settings'));
        await screen.findByText('Log settings saved for this server.');
        expect(api.put).toHaveBeenCalledWith(
            '/guilds/A/modules/audit-log',
            expect.objectContaining({
                enabled: false,
                config: expect.objectContaining({
                    channelId: '333333333333333333',
                    retentionDays: 3,
                    retainContent: false,
                }),
            })
        );
    });
    it('saves onboarding templates and role policy to the selected server', async () => {
        const onboarding = {
            ...module,
            id: 'onboarding',
            description: 'Welcome members',
        };
        vi.mocked(api.get).mockImplementation(async (url) => ({
            data:
                url === '/guilds'
                    ? [{ id: 'A', name: 'Server A', icon: null }]
                    : [onboarding],
        }));
        open('onboarding');
        fireEvent.change(await screen.findByLabelText('Welcome channel ID'), {
            target: { value: '666666666666666666' },
        });
        fireEvent.change(
            screen.getByLabelText('Join role IDs, separated by commas'),
            { target: { value: '777777777777777777' } }
        );
        fireEvent.click(screen.getByText('Save onboarding settings'));
        await screen.findByText('Onboarding settings saved for this server.');
        expect(api.put).toHaveBeenCalledWith(
            '/guilds/A/modules/onboarding',
            expect.objectContaining({
                enabled: false,
                config: expect.objectContaining({
                    channelId: '666666666666666666',
                    joinRoles: ['777777777777777777'],
                    requireRules: false,
                }),
            })
        );
    });
    it('saves role options and exclusivity policy for the selected server', async () => {
        const selfRoles = {
            ...module,
            id: 'self-roles',
            description: 'Self-service roles',
        };
        vi.mocked(api.get).mockImplementation(async (url) => ({
            data:
                url === '/guilds'
                    ? [{ id: 'A', name: 'Server A', icon: null }]
                    : [selfRoles],
        }));
        open('self-roles');
        fireEvent.change(
            await screen.findByLabelText('Role panel channel ID'),
            { target: { value: '666666666666666666' } }
        );
        fireEvent.click(screen.getByText('Add role option'));
        fireEvent.change(screen.getByLabelText('Role ID'), {
            target: { value: '777777777777777777' },
        });
        fireEvent.change(screen.getByLabelText('Label'), {
            target: { value: 'Color' },
        });
        fireEvent.change(screen.getByLabelText('Exclusive group (optional)'), {
            target: { value: 'color' },
        });
        fireEvent.click(screen.getByText('Save role settings'));
        await screen.findByText('Role settings saved for this server.');
        expect(api.put).toHaveBeenCalledWith(
            '/guilds/A/modules/self-roles',
            expect.objectContaining({
                config: expect.objectContaining({
                    roles: [
                        {
                            roleId: '777777777777777777',
                            label: 'Color',
                            group: 'color',
                            requires: [],
                        },
                    ],
                }),
            })
        );
    });
    it('saves anti-spam in observation by default', async () => {
        const antiSpam = {
            ...module,
            id: 'anti-spam',
            description: 'Spam decisions',
        };
        vi.mocked(api.get).mockImplementation(async (url) => ({
            data:
                url === '/guilds'
                    ? [{ id: 'A', name: 'Server A', icon: null }]
                    : [antiSpam],
        }));
        open('anti-spam');
        expect(
            await screen.findByLabelText(
                'Observe only; record decisions without timing out members'
            )
        ).toBeChecked();
        fireEvent.click(screen.getByText('Save anti-spam policy'));
        await screen.findByText('Anti-spam policy saved for this server.');
        expect(api.put).toHaveBeenCalledWith(
            '/guilds/A/modules/anti-spam',
            expect.objectContaining({
                config: expect.objectContaining({
                    observeOnly: true,
                    messageLimit: 6,
                }),
            })
        );
    });
});
