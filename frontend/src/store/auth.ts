import { create } from 'zustand';

export type Session = {
    discordId: string;
    username: string;
    avatar?: string;
    email?: string;
    role: 'ADMIN' | 'USER' | 'MODERATOR' | 'BANNED';
};

type AuthState = {
    accessToken: string | null;
    session: Session | null;
    sessionStatus:
        | 'unknown'
        | 'loading'
        | 'authenticated'
        | 'anonymous'
        | 'unavailable';
    sessionError: string | null;
    revision: number;
    setToken: (token: string) => void;
    logout: () => void;
};

export const useAuth = create<AuthState>((set) => ({
    accessToken: null,
    session: null,
    sessionStatus: 'unknown',
    sessionError: null,
    revision: 0,
    setToken: (token) => set({ accessToken: token }),
    logout: () => {
        set((state) => ({
            accessToken: null,
            session: null,
            sessionStatus: 'anonymous',
            sessionError: null,
            revision: state.revision + 1,
        }));
    },
}));
