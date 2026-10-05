import { z } from 'zod';

export const suggestionsConfig = z
    .object({
        channelId: z
            .string()
            .regex(/^\d{17,20}$/)
            .nullable()
            .default(null),
    })
    .strict();

export const afkConfig = z.object({}).strict();
export const birthdaysConfig = z
    .object({
        channelId: z
            .string()
            .regex(/^\d{17,20}$/)
            .nullable()
            .default(null),
        timeZone: z
            .string()
            .max(80)
            .default('UTC')
            .refine((value) => {
                try {
                    new Intl.DateTimeFormat('en', { timeZone: value });
                    return true;
                } catch {
                    return false;
                }
            }, 'Unknown IANA time zone'),
        hour: z.number().int().min(0).max(23).default(9),
        leapDay: z.enum(['feb28', 'mar1']).default('mar1'),
    })
    .strict();
