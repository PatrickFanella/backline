import { z } from 'zod';

export const scheduledUtilitiesConfig = z.object({}).strict();

export const localSchedule = z
    .object({
        local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
        timeZone: z.string().min(1).max(80),
        disambiguation: z
            .enum(['reject', 'earlier', 'later'])
            .default('reject'),
    })
    .strict();
export function resolveLocalTime(input: z.input<typeof localSchedule>): Date {
    const { local, timeZone, disambiguation } = localSchedule.parse(input);
    const [year, month, day, hour, minute] = local.split(/[-T:]/).map(Number);
    const naive = Date.UTC(year, month - 1, day, hour, minute);
    const date = new Date(naive);
    if (
        year < 2000 ||
        year > 2100 ||
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() + 1 !== month ||
        date.getUTCDate() !== day ||
        date.getUTCHours() !== hour ||
        date.getUTCMinutes() !== minute
    )
        throw new Error('Invalid local date or time');
    let format: Intl.DateTimeFormat;
    try {
        format = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        });
    } catch {
        throw new Error('Unknown IANA time zone');
    }
    const matches: Date[] = [];
    // Covers all IANA UTC offsets and both sides of a repeated local minute.
    for (let delta = -18 * 60; delta <= 18 * 60; delta++) {
        const candidate = new Date(naive + delta * 60000);
        const parts = Object.fromEntries(
            format
                .formatToParts(candidate)
                .map((part) => [part.type, part.value])
        );
        if (
            `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` ===
            local
        )
            matches.push(candidate);
    }
    if (!matches.length)
        throw new Error(
            'This local time does not exist in the selected time zone'
        );
    if (matches.length > 1 && disambiguation === 'reject')
        throw new Error(
            'This local time occurs twice; choose earlier or later explicitly'
        );
    return disambiguation === 'later'
        ? matches[matches.length - 1]
        : matches[0];
}
