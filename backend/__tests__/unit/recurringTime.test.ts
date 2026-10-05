import { nextRecurringTime } from '../../src/community/scheduledUtilities';

describe('recurring local calendar', () => {
    it('skips a missing spring time', () => {
        expect(
            nextRecurringTime(
                '2026-03-07T02:30',
                'America/New_York',
                'daily',
                'earlier'
            ).local
        ).toBe('2026-03-09T02:30');
    });
    it('skips the missing weekly occurrence', () => {
        expect(
            nextRecurringTime(
                '2026-03-01T02:30',
                'America/New_York',
                'weekly',
                'earlier'
            ).local
        ).toBe('2026-03-15T02:30');
    });
    it('respects both repeated fall choices', () => {
        const earlier = nextRecurringTime(
            '2026-10-31T01:30',
            'America/New_York',
            'daily',
            'earlier'
        );
        const later = nextRecurringTime(
            '2026-10-31T01:30',
            'America/New_York',
            'daily',
            'later'
        );
        expect(later.at.getTime() - earlier.at.getTime()).toBe(3600000);
    });
});
