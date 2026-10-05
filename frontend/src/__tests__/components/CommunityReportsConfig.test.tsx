import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CommunityReportsConfig from '../../components/CommunityReportsConfig';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
const props = {
    guildId: '777777777777777821',
    enabled: false,
    config: {},
    onSaved: vi.fn().mockResolvedValue(undefined),
    onBusy: vi.fn(),
};
const report = {
    coverage: {
        status: 'UNAVAILABLE',
        observedMinutes: 0,
        expectedMinutes: 10080,
        note: 'Observed samples',
    },
    totals: null,
    days: [],
    channels: [],
    cohort: { observedJoins: 0, observedDepartures: 0, retentionRate: null },
};
describe('community report evidence and settings', () => {
    beforeEach(() => vi.clearAllMocks());
    it('shows unavailable history without claiming zero activity', async () => {
        vi.mocked(api.get).mockResolvedValue({ data: report });
        render(<CommunityReportsConfig {...props} />);
        fireEvent.click(
            screen.getByRole('button', { name: 'Load community report' })
        );
        await screen.findByText(
            'History unavailable for this range. Zero activity cannot be inferred.'
        );
        expect(
            screen.queryByText('Members who sent messages')
        ).not.toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith(
            `/guilds/${props.guildId}/community-report`,
            { params: { from: expect.any(String), to: expect.any(String) } }
        );
    });
    it('labels partial totals and keeps retention unavailable', async () => {
        vi.mocked(api.get).mockResolvedValue({
            data: {
                ...report,
                coverage: {
                    ...report.coverage,
                    status: 'PARTIAL',
                    observedMinutes: 30,
                },
                totals: {
                    messages: 12,
                    joins: 2,
                    departures: 1,
                    activeMembers: 3,
                },
                days: [{ day: '2026-10-05', kind: 'messages', count: 12 }],
            },
        });
        render(<CommunityReportsConfig {...props} />);
        fireEvent.click(
            screen.getByRole('button', { name: 'Load community report' })
        );
        await screen.findByText(
            'Collection was partial. Totals include observed events only.'
        );
        expect(
            screen.getByText('Members who sent messages')
        ).toBeInTheDocument();
        expect(screen.getByText(/Retention: unavailable/)).toBeInTheDocument();
        expect(screen.getByRole('table')).toHaveAccessibleName(
            'Daily observations (UTC)'
        );
    });
    it('saves a bounded counter policy without enabling collection', async () => {
        vi.mocked(api.put).mockResolvedValue({ data: { success: true } });
        render(<CommunityReportsConfig {...props} />);
        fireEvent.click(
            screen.getByRole('button', { name: 'Add channel counter' })
        );
        fireEvent.change(screen.getByLabelText('Counter channel ID'), {
            target: { value: '777777777777777824' },
        });
        fireEvent.click(
            screen.getByRole('button', {
                name: 'Save community report settings',
            })
        );
        await screen.findByText('Community report settings saved.');
        expect(api.put).toHaveBeenCalledWith(
            `/guilds/${props.guildId}/modules/community-reports`,
            {
                enabled: false,
                config: {
                    retentionDays: 30,
                    excludedChannels: [],
                    counters: [
                        {
                            channelId: '777777777777777824',
                            metric: 'messages',
                            days: 1,
                            intervalMinutes: 60,
                        },
                    ],
                },
            }
        );
    });
});
