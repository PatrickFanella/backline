import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TicketConfig from '../../components/TicketConfig';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { put: vi.fn() } }));
describe('ticket settings', () => {
    beforeEach(() => vi.resetAllMocks());
    it('saves staff roles to the selected server with content disabled', async () => {
        const saved = vi.fn().mockResolvedValue(undefined),
            busy = vi.fn();
        vi.mocked(api.put).mockResolvedValue({ data: { success: true } });
        render(
            <TicketConfig
                guildId="A"
                enabled={false}
                config={{}}
                onBusy={busy}
                onSaved={saved}
            />
        );
        fireEvent.change(
            screen.getByLabelText('Staff role IDs, separated by commas'),
            { target: { value: '111111111111111111, 222222222222222222' } }
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'Save ticket settings' })
        );
        await screen.findByText('Ticket settings saved.');
        expect(api.put).toHaveBeenCalledWith('/guilds/A/modules/tickets', {
            enabled: false,
            config: {
                staffRoles: ['111111111111111111', '222222222222222222'],
                retentionDays: 7,
                maxOpen: 25,
                retainContent: false,
            },
        });
        expect(saved).toHaveBeenCalledTimes(1);
        expect(busy).toHaveBeenLastCalledWith(false);
    });
    it('preserves entered settings when authorization or policy denies saving', async () => {
        vi.mocked(api.put).mockRejectedValue(new Error('denied'));
        const saved = vi.fn();
        render(
            <TicketConfig
                guildId="B"
                enabled={true}
                config={{ staffRoles: ['111111111111111111'] }}
                onBusy={vi.fn()}
                onSaved={saved}
            />
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'Save ticket settings' })
        );
        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent('not saved')
        );
        expect(saved).not.toHaveBeenCalled();
        expect(
            screen.getByLabelText('Staff role IDs, separated by commas')
        ).toHaveValue('111111111111111111');
    });
});
