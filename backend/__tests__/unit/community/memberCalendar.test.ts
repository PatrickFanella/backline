import {
    birthdayMatches,
    localCalendar,
    nextLocalDayBoundary,
} from '../../../src/community/memberUtilities';

describe('birthday calendar rules', () => {
    it('uses the server local calendar across UTC date boundaries', () => {
        expect(
            localCalendar(new Date('2026-10-05T01:00:00Z'), 'America/Chicago')
        ).toMatchObject({ year: 2026, month: 10, day: 4, hour: 20 });
    });
    it('observes February 29 only on the chosen fallback in nonleap years', () => {
        expect(
            birthdayMatches(2, 29, { year: 2027, month: 2, day: 28 }, 'feb28')
        ).toBe(true);
        expect(
            birthdayMatches(2, 29, { year: 2027, month: 3, day: 1 }, 'mar1')
        ).toBe(true);
        expect(
            birthdayMatches(2, 29, { year: 2027, month: 2, day: 28 }, 'mar1')
        ).toBe(false);
    });
    it('finds a day boundary when local midnight is skipped', () => {
        const now = new Date('2026-09-05T16:00:00Z');
        const boundary = nextLocalDayBoundary(now, 'America/Santiago');
        expect(
            localCalendar(new Date(boundary.getTime() - 1), 'America/Santiago')
                .date
        ).toBe('2026-09-05');
        expect(localCalendar(boundary, 'America/Santiago')).toMatchObject({
            date: '2026-09-06',
            hour: 1,
        });
    });
    it('uses the actual February 29 in leap years', () => {
        expect(
            birthdayMatches(2, 29, { year: 2028, month: 2, day: 29 }, 'mar1')
        ).toBe(true);
        expect(
            birthdayMatches(2, 29, { year: 2028, month: 3, day: 1 }, 'mar1')
        ).toBe(false);
    });
});
