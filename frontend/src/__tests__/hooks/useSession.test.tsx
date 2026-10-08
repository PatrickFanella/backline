import { act, render, screen, waitFor } from '@testing-library/react';
import { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadSession, useSession } from '../../hooks/useSession';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';

vi.mock('../../lib/api');
const account = { discordId: '123', username: 'Owner', role: 'USER' as const };
function Consumer() {
    const { session, loading, error } = useSession();
    return (
        <p>
            {loading ? 'Checking' : session?.username || error || 'Anonymous'}
        </p>
    );
}
beforeEach(() => {
    vi.clearAllMocks();
    useAuth.setState((s) => ({
        accessToken: null,
        session: null,
        sessionStatus: 'unknown',
        sessionError: null,
        revision: s.revision + 1,
    }));
});
describe('Shared session lifecycle', () => {
    it('shares bootstrap across mounted consumers and subsequent navigation', async () => {
        vi.mocked(api.get).mockResolvedValue({ data: account });
        const view = render(
            <>
                <Consumer />
                <Consumer />
            </>
        );
        await waitFor(() =>
            expect(screen.getAllByText('Owner')).toHaveLength(2)
        );
        expect(api.get).toHaveBeenCalledTimes(1);
        view.unmount();
        render(<Consumer />);
        expect(screen.getByText('Owner')).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledTimes(1);
    });
    it('cannot restore an old account after sign-out during bootstrap', async () => {
        let finish!: (value: { data: typeof account }) => void;
        vi.mocked(api.get).mockReturnValue(
            new Promise((resolve) => {
                finish = resolve;
            })
        );
        render(<Consumer />);
        act(() => useAuth.getState().logout());
        await act(async () => finish({ data: account }));
        expect(screen.getByText('Anonymous')).toBeInTheDocument();
        expect(useAuth.getState().session).toBeNull();
    });
    it('keeps the last account during a temporary outage and supports retry', async () => {
        useAuth.setState({ session: account, sessionStatus: 'authenticated' });
        vi.mocked(api.get)
            .mockRejectedValueOnce(new AxiosError('Offline'))
            .mockResolvedValueOnce({ data: account });
        await loadSession(true);
        expect(useAuth.getState().session).toEqual(account);
        expect(useAuth.getState().sessionStatus).toBe('unavailable');
        await loadSession(true);
        expect(useAuth.getState().sessionStatus).toBe('authenticated');
    });
    it('clears a session that the server rejects', async () => {
        const error = new AxiosError('Unauthorized');
        error.response = { status: 401 } as typeof error.response;
        vi.mocked(api.get).mockRejectedValue(error);
        await loadSession();
        expect(useAuth.getState().sessionStatus).toBe('anonymous');
    });
});
