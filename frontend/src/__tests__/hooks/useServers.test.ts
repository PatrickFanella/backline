import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useServers } from '../../hooks/useServers';
import api from '../../lib/api';
import { useGuild } from '../../store/guild';

vi.mock('../../lib/api');
const servers = [
    { id: 'first', name: 'First', icon: null },
    { id: 'selected', name: 'Selected', icon: null },
];

beforeEach(() => {
    vi.clearAllMocks();
    useGuild.getState().selectGuild('selected');
});

describe('remembered server authorization', () => {
    it('keeps a remembered server when it is still authorized', async () => {
        vi.mocked(api.get).mockResolvedValue({ data: servers });
        const { result } = renderHook(() => useServers('sync'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(useGuild.getState().guildId).toBe('selected');
    });

    it('replaces a remembered server after access is lost', async () => {
        vi.mocked(api.get).mockResolvedValue({ data: [servers[0]] });
        const { result } = renderHook(() => useServers('sync'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(useGuild.getState().guildId).toBe('first');
    });

    it('clears a remembered server when no servers are authorized', async () => {
        vi.mocked(api.get).mockResolvedValue({ data: [] });
        const { result } = renderHook(() => useServers('sync'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(useGuild.getState().guildId).toBeNull();
    });
});
