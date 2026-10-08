import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';

import BrandHeader from '../../components/BrandHeader';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';

vi.mock('../../lib/api');
vi.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({ effectiveTheme: 'dark' }),
}));
vi.mock('../../components/ui/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('../../components/ui/LanguageSwitcher', () => ({
    LanguageSwitcher: () => null,
}));
beforeEach(() => {
    vi.clearAllMocks();
    useAuth.setState((s) => ({
        session: null,
        accessToken: null,
        sessionStatus: 'unknown',
        sessionError: null,
        revision: s.revision + 1,
    }));
});
it('keeps account and management navigation while visiting status', async () => {
    vi.mocked(api.get).mockResolvedValue({
        data: { discordId: '123', username: 'Owner', role: 'USER' },
    });
    render(
        <MemoryRouter initialEntries={['/servers']}>
            <BrandHeader />
            <Routes>
                <Route path="/servers" element={<p>Server page</p>} />
                <Route path="/status" element={<p>Status page</p>} />
            </Routes>
        </MemoryRouter>
    );
    await screen.findByText('Owner', { selector: 'strong' });
    fireEvent.click(screen.getByRole('link', { name: 'Status' }));
    await screen.findByText('Status page');
    for (const label of ['Server setup', 'Moderation', 'Activity'])
        expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    expect(
        screen.queryByRole('link', { name: 'Sign in' })
    ).not.toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
});
