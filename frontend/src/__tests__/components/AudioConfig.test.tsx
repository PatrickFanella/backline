import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AudioConfig from '../../components/AudioConfig';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { put: vi.fn() } }));
describe('radio configuration', () => {
    it('saves DEF CON Radio and bounded defaults for the selected server', async () => {
        vi.mocked(api.put).mockResolvedValue({ data: { success: true } });
        const saved = vi.fn().mockResolvedValue(undefined);
        render(
            <AudioConfig
                guildId="B"
                enabled={false}
                config={{}}
                onBusy={vi.fn()}
                onSaved={saved}
            />
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'Save radio settings' })
        );
        await screen.findByText('Radio settings saved.');
        expect(api.put).toHaveBeenCalledWith('/guilds/B/modules/audio', {
            enabled: false,
            config: {
                queuesEnabled: false,
                clipsEnabled: false,
                defaultStation: 'defcon',
                djRoles: [],
                volume: 25,
                maxMinutes: 30,
                idleSeconds: 60,
            },
        });
        expect(saved).toHaveBeenCalledTimes(1);
    });
});
