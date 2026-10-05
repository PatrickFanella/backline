import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import BirthdaysConfig from '../../components/BirthdaysConfig';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { put: vi.fn() } }));
describe('birthday setup', () => {
    beforeEach(() => {
        vi.mocked(api.put).mockReset();
    });
    it('saves the channel without enabling a disabled module', async () => {
        vi.mocked(api.put).mockResolvedValue({ data: { success: true } });
        const onSaved = vi.fn().mockResolvedValue(undefined);
        render(
            <BirthdaysConfig
                guildId="guild"
                enabled={false}
                config={{}}
                onSaved={onSaved}
                onBusy={vi.fn()}
            />
        );
        await userEvent.type(
            screen.getByLabelText('Birthday channel ID'),
            '777777777777777864'
        );
        await userEvent.click(
            screen.getByRole('button', { name: 'Save birthday settings' })
        );
        expect(
            await screen.findByText('Birthday settings saved.')
        ).toBeInTheDocument();
        expect(api.put).toHaveBeenCalledWith(
            '/guilds/guild/modules/birthdays',
            {
                enabled: false,
                config: {
                    channelId: '777777777777777864',
                    timeZone: 'UTC',
                    hour: 9,
                    leapDay: 'mar1',
                },
            }
        );
        expect(onSaved).toHaveBeenCalledTimes(1);
    });
    it('reports a rejected save and keeps the editor available', async () => {
        vi.mocked(api.put).mockRejectedValue(new Error('Unavailable'));
        render(
            <BirthdaysConfig
                guildId="guild"
                enabled
                config={{ channelId: '777777777777777864' }}
                onSaved={vi.fn()}
                onBusy={vi.fn()}
            />
        );
        await userEvent.click(
            screen.getByRole('button', { name: 'Save birthday settings' })
        );
        expect(
            await screen.findByText('Birthday settings could not be saved.')
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Save birthday settings' })
        ).toBeEnabled();
    });
});
