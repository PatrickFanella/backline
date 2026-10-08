import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SessionStatus from '../../components/SessionStatus';
import { useSession } from '../../hooks/useSession';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';

vi.mock('../../hooks/useSession');
vi.mock('../../lib/api');
const account = {
    discordId: '247472026191790082',
    username: 'patrick__eff#0',
    role: 'USER' as const,
};
function show() {
    return render(
        <MemoryRouter initialEntries={['/status']}>
            <SessionStatus />
            <Routes>
                <Route path="/status" element={<p>Status page</p>} />
                <Route
                    path="/login"
                    element={<p>Choose a Discord account</p>}
                />
                <Route path="/" element={<p>Home page</p>} />
            </Routes>
        </MemoryRouter>
    );
}
beforeEach(() => {
    vi.clearAllMocks();
    useAuth.setState({
        accessToken: 'access',
        session: account,
        sessionStatus: 'authenticated',
    });
    vi.mocked(useSession).mockReturnValue({
        session: account,
        loading: false,
        error: null,
    });
});
describe('Account indicator', () => {
    it('names the Discord account without the obsolete discriminator', () => {
        show();
        expect(
            screen.getByText('patrick__eff', { selector: 'strong' })
        ).toBeInTheDocument();
        expect(screen.getByText(/Signed in as/)).toBeInTheDocument();
    });
    it('revokes the session before switching accounts', async () => {
        vi.mocked(api.post).mockResolvedValue({ data: {} });
        show();
        fireEvent.click(screen.getByRole('button', { name: 'Switch account' }));
        await screen.findByText('Choose a Discord account');
        expect(api.post).toHaveBeenCalledWith('/auth/logout');
        expect(useAuth.getState().accessToken).toBeNull();
        expect(useAuth.getState().session).toBeNull();
    });
    it('does not claim sign-out succeeded when revocation fails', async () => {
        vi.mocked(api.post).mockRejectedValue(new Error('Offline'));
        show();
        fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
        await waitFor(() =>
            expect(screen.getByRole('alert')).toHaveTextContent(
                'Could not sign out'
            )
        );
        expect(useAuth.getState().session).toEqual(account);
    });
    it('shows a sign-in link for an anonymous visitor', () => {
        vi.mocked(useSession).mockReturnValue({
            session: null,
            loading: false,
            error: null,
        });
        show();
        expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
            'href',
            '/login'
        );
    });
});
