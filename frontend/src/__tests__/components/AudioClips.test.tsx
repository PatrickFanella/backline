import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AudioClips from '../../components/AudioClips';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({
    default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
const clip = {
    id: 'clip-one',
    title: 'Original pulse',
    byteSize: 1000,
    durationMs: 100,
    source: 'Own synth',
    license: 'Original recording',
    rights: 'original',
    approvedBy: 'manager',
};
describe('manager clip approvals', () => {
    it('searches metadata, saves explicit board choices and withdraws approval', async () => {
        vi.mocked(api.get).mockImplementation(async (url) => ({
            data: url.endsWith('/clips') ? [clip] : [],
        }));
        vi.mocked(api.put).mockResolvedValue({ data: {} });
        vi.mocked(api.delete).mockResolvedValue({ data: {} });
        render(<AudioClips guildId="one" onBusy={vi.fn()} />);
        expect(await screen.findByText('Original pulse')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Search clip titles'), {
            target: { value: 'missing' },
        });
        expect(screen.queryByText('Original pulse')).not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Search clip titles'), {
            target: { value: '' },
        });
        fireEvent.change(screen.getByLabelText('Soundboard name'), {
            target: { value: 'Pulse' },
        });
        fireEvent.click(screen.getByLabelText('Include Original pulse'));
        fireEvent.click(screen.getByText('Save soundboard'));
        expect(
            await screen.findByText('Soundboard saved.')
        ).toBeInTheDocument();
        expect(api.put).toHaveBeenCalledWith(
            '/guilds/one/modules/audio/soundboards',
            { name: 'Pulse', clipIds: ['clip-one'] }
        );
        await waitFor(() =>
            expect(screen.getByText('Remove Original pulse')).toBeEnabled()
        );
        fireEvent.click(screen.getByText('Remove Original pulse'));
        expect(
            await screen.findByText('Clip approval withdrawn.')
        ).toBeInTheDocument();
        expect(api.delete).toHaveBeenCalledWith(
            '/guilds/one/modules/audio/clips/clip-one'
        );
    });
    it('reports a failed catalog without claiming it is empty', async () => {
        vi.mocked(api.get).mockRejectedValue(new Error('offline'));
        render(<AudioClips guildId="one" onBusy={vi.fn()} />);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'could not be loaded'
        );
        expect(
            screen.queryByText('No approved clips.')
        ).not.toBeInTheDocument();
    });
    it('requires review confirmation before uploading bytes', async () => {
        vi.mocked(api.get).mockResolvedValue({ data: [] });
        vi.mocked(api.post).mockResolvedValue({ data: {} });
        render(<AudioClips guildId="one" onBusy={vi.fn()} />);
        await screen.findByText('No approved clips.');
        const file = new File(['wav'], 'pulse.wav', { type: 'audio/wav' });
        Object.defineProperty(file, 'arrayBuffer', {
            value: () => Promise.resolve(new ArrayBuffer(3)),
        });
        fireEvent.change(screen.getByLabelText('WAV file'), {
            target: { files: [file] },
        });
        fireEvent.submit(
            screen.getByText('Approve and upload clip').closest('form')!
        );
        expect(api.post).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('Clip title'), {
            target: { value: 'Pulse' },
        });
        fireEvent.change(screen.getByLabelText('Source or creator'), {
            target: { value: 'My synth' },
        });
        fireEvent.change(
            screen.getByLabelText('License or permission record'),
            { target: { value: 'Original recording' } }
        );
        fireEvent.click(
            screen.getByLabelText(
                'I reviewed this audio and approve its use in this server.'
            )
        );
        fireEvent.submit(
            screen.getByText('Approve and upload clip').closest('form')!
        );
        expect(
            await screen.findByText('Clip approved and stored.')
        ).toBeInTheDocument();
        expect(api.post).toHaveBeenCalledWith(
            '/guilds/one/modules/audio/clips',
            expect.any(ArrayBuffer),
            {
                headers: { 'Content-Type': 'audio/wav' },
                params: {
                    title: 'Pulse',
                    source: 'My synth',
                    license: 'Original recording',
                    rights: 'original',
                    confirmed: true,
                },
            }
        );
    });
});
