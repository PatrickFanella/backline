import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import AudioQueue from '../../components/AudioQueue';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({
    default: { get: vi.fn(), post: vi.fn() },
}));

const diagnostics = {
    stations: [{ id: 'defcon', title: 'DEF CON Radio' }],
    queue: {
        state: 'PLAYING',
        loop: false,
        shuffle: true,
        items: [
            {
                id: 'item-1',
                station: 'defcon',
                minutes: 10,
                requesterId: '123456789012345678',
            },
        ],
    },
    playlists: [
        {
            id: 'playlist-1',
            name: 'Late night',
            items: [],
        },
    ],
    playback: [
        {
            id: 'playback-1',
            stationId: 'defcon',
            state: 'STOPPED',
            detail: 'Queue skip',
            playbackMs: 1000,
            daveProtocol: 1,
        },
    ],
    jobs: [
        { id: 'job-delivered', state: 'DELIVERED', lastError: null },
        { id: 'job-held', state: 'RECONCILE', lastError: 'Current DJ changed' },
    ],
};

describe('audio queue dashboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('crypto', {
            randomUUID: () => '8d2f6d15-2e28-4e31-a4b4-4a65c937ae18',
        });
        vi.mocked(api.get).mockResolvedValue({ data: diagnostics });
        vi.mocked(api.post).mockResolvedValue({ data: { id: 'job-new' } });
    });

    it('shows persisted diagnostics and provides playback controls for the current voice session', async () => {
        render(<AudioQueue guildId="guild-one" onBusy={vi.fn()} />);

        expect(
            await screen.findByText('Queue state: PLAYING · 1 pending entries.')
        ).toBeInTheDocument();
        expect(screen.getByText(/defcon · 10 minutes/)).toBeInTheDocument();
        expect(screen.getByText(/Queue skip/)).toBeInTheDocument();
        expect(screen.getByText(/DAVE 1/)).toBeInTheDocument();
        expect(
            screen.getByText(/job-delivered · DELIVERED/)
        ).toBeInTheDocument();
        expect(
            screen.getByText(/job-held · RECONCILE · Current DJ changed/)
        ).toBeInTheDocument();
        for (const control of ['pause', 'resume', 'skip', 'stop'])
            expect(screen.getByRole('button', { name: control })).toBeEnabled();
        expect(
            screen.getByRole('button', { name: 'Shuffle: on' })
        ).toBeEnabled();
    });

    it('queues a start request, exposes the busy transition, and keeps the action worker-bound', async () => {
        const onBusy = vi.fn();
        render(<AudioQueue guildId="guild-one" onBusy={onBusy} />);
        await screen.findByText(/Queue state:/);

        fireEvent.click(screen.getByRole('button', { name: 'Start queue' }));

        await waitFor(() =>
            expect(api.post).toHaveBeenCalledWith(
                '/guilds/guild-one/modules/audio/actions',
                {
                    action: 'start',
                    requestId: '8d2f6d15-2e28-4e31-a4b4-4a65c937ae18',
                }
            )
        );
        expect(
            await screen.findByText(/Audio action queued: job-new/)
        ).toHaveTextContent('fresh voice and DJ checks');
        expect(onBusy).toHaveBeenCalledWith(true);
        expect(onBusy).toHaveBeenLastCalledWith(false);
    });

    it('disables empty playlist saves and queues explicit playlist operations once named', async () => {
        render(<AudioQueue guildId="guild-one" onBusy={vi.fn()} />);
        await screen.findByText(/Queue state:/);

        const save = screen.getByRole('button', { name: 'Save queue' });
        expect(save).toBeDisabled();
        fireEvent.change(screen.getByPlaceholderText('Playlist name'), {
            target: { value: 'Afterhours' },
        });
        expect(save).toBeEnabled();
        fireEvent.click(save);
        await waitFor(() =>
            expect(api.post).toHaveBeenCalledWith(
                '/guilds/guild-one/modules/audio/actions',
                {
                    action: 'playlist',
                    operation: 'save',
                    name: 'Afterhours',
                    requestId: '8d2f6d15-2e28-4e31-a4b4-4a65c937ae18',
                }
            )
        );
        fireEvent.click(screen.getByRole('button', { name: 'Load' }));
        await waitFor(() =>
            expect(api.post).toHaveBeenLastCalledWith(
                '/guilds/guild-one/modules/audio/actions',
                {
                    action: 'playlist',
                    operation: 'load',
                    name: 'Late night',
                    requestId: '8d2f6d15-2e28-4e31-a4b4-4a65c937ae18',
                }
            )
        );
    });

    it('has no automated accessibility violations after diagnostics load', async () => {
        const { container } = render(
            <AudioQueue guildId="guild-one" onBusy={vi.fn()} />
        );
        await screen.findByText(/Queue state:/);

        expect((await axe(container)).violations).toEqual([]);
    });
});
