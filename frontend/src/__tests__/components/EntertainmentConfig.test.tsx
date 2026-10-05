import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import EntertainmentConfig from '../../components/EntertainmentConfig';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
const props = {
    guildId: 'one',
    enabled: false,
    config: {},
    onSaved: vi.fn().mockResolvedValue(undefined),
    onBusy: vi.fn(),
};
const template = {
    id: 'loading',
    name: 'Still loading',
    description: 'Original layout',
    provenance: {
        creator: 'Backline',
        source: 'catalog.ts',
        license: 'GPLv3',
        assets: 'Original geometry',
    },
};
describe('entertainment approvals', () => {
    it('saves explicit approvals without enabling the module', async () => {
        vi.mocked(api.get).mockImplementation(async (url) => ({
            data: url.endsWith('/catalog') ? [template] : [],
        }));
        vi.mocked(api.put).mockResolvedValue({ data: {} });
        render(<EntertainmentConfig {...props} />);
        fireEvent.click(await screen.findByLabelText('Approve Still loading'));
        fireEvent.click(
            screen.getByLabelText('Enable collection claims and trading')
        );
        fireEvent.click(screen.getByText('Save entertainment approvals'));
        expect(
            await screen.findByText('Entertainment approvals saved.')
        ).toBeInTheDocument();
        expect(api.put).toHaveBeenCalledWith(
            '/guilds/one/modules/entertainment',
            {
                enabled: false,
                config: {
                    approvedTemplates: ['loading'],
                    collectionsEnabled: true,
                },
            }
        );
    });
    it('reports unavailable history rather than claiming no trades', async () => {
        vi.mocked(api.get).mockRejectedValue(new Error('offline'));
        render(<EntertainmentConfig {...props} />);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'could not be loaded'
        );
        expect(
            screen.queryByText('No retained collection trades.')
        ).not.toBeInTheDocument();
    });
    it('retains the preview until unmount and then releases its blob URL', async () => {
        const create = vi.fn(() => 'blob:preview'),
            revoke = vi.fn();
        vi.stubGlobal(
            'URL',
            Object.assign(URL, {
                createObjectURL: create,
                revokeObjectURL: revoke,
            })
        );
        vi.mocked(api.get).mockImplementation(async (url) => ({
            data: url.endsWith('/catalog')
                ? [template]
                : url.endsWith('/preview')
                  ? new Blob(['png'])
                  : [],
        }));
        const view = render(<EntertainmentConfig {...props} />);
        fireEvent.click(await screen.findByText('Preview Still loading'));
        await waitFor(() =>
            expect(
                screen.getByAltText('Still loading sample layout')
            ).toHaveAttribute('src', 'blob:preview')
        );
        expect(revoke).not.toHaveBeenCalled();
        view.unmount();
        expect(revoke).toHaveBeenCalledWith('blob:preview');
    });
});
