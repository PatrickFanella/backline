import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { loadSession, useSession } from '../hooks/useSession';
import api from '../lib/api';
import { useAuth } from '../store/auth';

export default function SessionStatus({
    enabled = true,
}: {
    enabled?: boolean;
}) {
    const { session, loading, error } = useSession(enabled);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const navigate = useNavigate();
    async function signOut(switchAccount: boolean) {
        setBusy(true);
        setNotice('');
        try {
            const revoke = () => api.post('/auth/logout');
            if (typeof navigator !== 'undefined' && navigator.locks)
                await navigator.locks.request(
                    'backline-session-refresh',
                    revoke
                );
            else await revoke();
            useAuth.getState().logout();
            if (typeof BroadcastChannel !== 'undefined') {
                const channel = new BroadcastChannel('backline-session');
                channel.postMessage('signed-out');
                channel.close();
            }
            navigate(switchAccount ? '/login' : '/', { replace: true });
        } catch {
            setNotice('Could not sign out. Please try again.');
        } finally {
            setBusy(false);
        }
    }
    if (!enabled) return null;
    if (loading && !session)
        return (
            <span role="status" className="text-sm text-bl-muted">
                Checking session…
            </span>
        );
    if (!session)
        return error ? (
            <button className="text-sm" onClick={() => void loadSession(true)}>
                Retry session check
            </button>
        ) : (
            <Link to="/login" className="text-sm">
                Sign in
            </Link>
        );
    const username = session.username.replace(/#0$/, '');
    return (
        <details className="relative text-sm">
            <summary className="max-w-48 truncate cursor-pointer rounded-lg border border-bl-border px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bl-accent">
                Signed in as <strong>{username}</strong>
            </summary>
            <div className="absolute left-0 sm:left-auto sm:right-0 z-50 mt-2 w-64 rounded-lg border border-bl-border bg-bl-panel p-4 shadow-lg">
                <p className="text-bl-muted mb-3">
                    Discord account: {username}
                </p>
                {error && (
                    <p role="status" className="mb-3">
                        {error}
                    </p>
                )}
                <button
                    disabled={busy}
                    onClick={() => void signOut(true)}
                    className="block w-full rounded border border-bl-border p-2 mb-2"
                >
                    Switch account
                </button>
                <button
                    disabled={busy}
                    onClick={() => void signOut(false)}
                    className="block w-full rounded border border-bl-border p-2"
                >
                    Sign out
                </button>
                {notice && (
                    <p role="alert" className="mt-2 text-bl-danger">
                        {notice}
                    </p>
                )}
            </div>
        </details>
    );
}
