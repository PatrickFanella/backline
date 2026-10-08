import { Navigate, Outlet } from 'react-router-dom';

import { loadSession, useSession } from '../hooks/useSession';

export default function RequireAuth() {
    const { session, loading, error } = useSession();

    if (loading && !session)
        return (
            <p role="status" className="p-8">
                Checking your session…
            </p>
        );
    if (error && !session)
        return (
            <div className="p-8">
                <p role="alert">{error}</p>
                <button onClick={() => void loadSession(true)}>
                    Retry session check
                </button>
            </div>
        );
    return session ? <Outlet /> : <Navigate to="/login" replace />;
}
