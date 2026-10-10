import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import api from '../../lib/api';
import Overview from '../../pages/Overview';
import { useGuild } from '../../store/guild';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn() } }));

const modules = [
    {
        id: 'onboarding',
        description: 'Welcome',
        operatorReady: true,
        permissions: [],
        intents: [],
        settings: { enabled: true, config: {} },
    },
    {
        id: 'audit-log',
        description: 'Logs',
        operatorReady: false,
        permissions: [],
        intents: [],
        settings: { enabled: false, config: {} },
    },
    {
        id: 'polls',
        description: 'Polls',
        operatorReady: true,
        permissions: [],
        intents: [],
        settings: { enabled: false, config: {} },
    },
];
const cases = [
    {
        id: 'c1',
        action: 'warn',
        state: 'QUEUED',
        reason: 'spam',
        createdAt: '2026-10-10T00:00:00Z',
    },
    {
        id: 'c2',
        action: 'ban',
        state: 'DELIVERED',
        reason: 'raid',
        createdAt: '2026-10-09T00:00:00Z',
    },
];

function open() {
    render(
        <MemoryRouter>
            <Overview />
        </MemoryRouter>
    );
}

describe('overview', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        useGuild.setState({ guildId: null });
        vi.mocked(api.get).mockImplementation(async (url) => {
            if (url === '/guilds')
                return {
                    data: [
                        { id: 'A', name: 'Server A', icon: null },
                        { id: 'B', name: 'Server B', icon: null },
                    ],
                };
            if (url === '/status')
                return { data: { status: 'healthy', timestamp: 'now' } };
            if (url.endsWith('/modules')) return { data: modules };
            if (url.endsWith('/moderation/cases')) return { data: cases };
            throw new Error(`unexpected ${url}`);
        });
    });
    it('summarizes the selected server and switches servers', async () => {
        open();
        await screen.findByRole('heading', { name: 'Server A' });
        await screen.findByText('1/3');
        expect(screen.getByText('Operational')).toBeInTheDocument();
        expect(screen.getByText('Onboarding')).toHaveClass('bl-badge-success');
        expect(
            screen.getByText(/Audit log need Discord intents/)
        ).toBeInTheDocument();
        expect(screen.getByText('QUEUED')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Server'), {
            target: { value: 'B' },
        });
        await waitFor(() =>
            expect(api.get).toHaveBeenCalledWith('/guilds/B/modules')
        );
        await screen.findByRole('heading', { name: 'Server B' });
    });
    it('keeps a stale selection instead of clearing it when the list is empty', async () => {
        useGuild.setState({ guildId: 'A' });
        vi.mocked(api.get).mockImplementation(async (url) => {
            if (url === '/guilds') return { data: [] };
            if (url === '/status') throw new Error('down');
            if (url.endsWith('/modules')) return { data: [] };
            return { data: [] };
        });
        open();
        await screen.findByText('No manageable servers found');
        expect(useGuild.getState().guildId).toBe('A');
        await screen.findByText('Unknown');
    });
    it('explains when module settings cannot be read', async () => {
        vi.mocked(api.get).mockImplementation(async (url) => {
            if (url === '/guilds')
                return { data: [{ id: 'A', name: 'Server A', icon: null }] };
            if (url.endsWith('/modules')) throw new Error('forbidden');
            return { data: [] };
        });
        open();
        await screen.findByRole('alert');
        expect(screen.getByRole('alert')).toHaveTextContent(/unavailable/);
    });
});
