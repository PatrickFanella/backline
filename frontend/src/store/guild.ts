import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const useGuild = create<{
    guildId: string | null;
    selectGuild: (id: string | null) => void;
}>()(
    persist(
        (set) => ({
            guildId: null,
            selectGuild: (guildId) => set({ guildId }),
        }),
        {
            name: 'backline-selected-server',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({ guildId: state.guildId }),
        }
    )
);
