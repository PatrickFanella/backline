import { formatPollResults } from '../../../src/community/polls';

describe('native poll tally readback', () => {
    const poll = {
        question: { text: 'Choose' },
        answers: [
            { answer_id: 8, poll_media: { text: 'Monday' } },
            { answer_id: 3, poll_media: { text: 'Tuesday' } },
        ],
    };
    it('does not turn missing provider results into zero votes', () => {
        expect(formatPollResults(poll)).toBe(
            'Discord has not supplied poll results yet. Try again later.'
        );
    });
    it('matches counts by answer ID and labels an open tally', () => {
        expect(
            formatPollResults({
                ...poll,
                results: {
                    is_finalized: false,
                    answer_counts: [{ id: 3, count: 12 }],
                },
            })
        ).toBe('Choose\nCurrent tally; may change\nMonday: 0\nTuesday: 12');
    });
    it('identifies a finalized tally', () => {
        expect(
            formatPollResults({
                ...poll,
                results: { is_finalized: true, answer_counts: [] },
            })
        ).toBe('Choose\nFinalized tally\nMonday: 0\nTuesday: 0');
    });
});
