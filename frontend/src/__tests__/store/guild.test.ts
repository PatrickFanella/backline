import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGuild } from '../../store/guild';

describe('selected server persistence', () => {
    beforeEach(() => {
        localStorage.clear();
        useGuild.setState({ guildId: null });
    });

    it('restores the selected server in a newly loaded store', async () => {
        useGuild.getState().selectGuild('1450935212170285237');
        vi.resetModules();
        const { useGuild: reloaded } = await import('../../store/guild');
        expect(reloaded.getState().guildId).toBe('1450935212170285237');
    });

    it('persists clearing a server selection', async () => {
        useGuild.getState().selectGuild('1450935212170285237');
        useGuild.getState().selectGuild(null);
        vi.resetModules();
        const { useGuild: reloaded } = await import('../../store/guild');
        expect(reloaded.getState().guildId).toBeNull();
    });
});
