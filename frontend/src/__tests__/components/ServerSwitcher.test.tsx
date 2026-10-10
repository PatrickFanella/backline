import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ServerSwitcher from '../../components/ServerSwitcher';
import { useGuild } from '../../store/guild';

describe('server switcher', () => {
    it('renders nothing without servers and selects by store otherwise', () => {
        useGuild.setState({ guildId: 'B' });
        const { rerender } = render(<ServerSwitcher servers={[]} />);
        expect(screen.queryByLabelText('Server')).not.toBeInTheDocument();
        rerender(
            <ServerSwitcher
                servers={[
                    { id: 'A', name: 'Alpha', icon: null },
                    { id: 'B', name: 'Beta', icon: 'abc' },
                ]}
            />
        );
        expect(screen.getByLabelText('Server')).toHaveValue('B');
        expect(screen.getByText('2 manageable servers')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Server'), {
            target: { value: 'A' },
        });
        expect(useGuild.getState().guildId).toBe('A');
    });
});
