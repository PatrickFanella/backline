import { create } from 'zustand';

export const useGuild = create<{
    guildId: string | null;
    selectGuild: (id: string | null) => void;
}>((set) => ({
    guildId: null,
    selectGuild: (guildId) => set({ guildId }),
}));
