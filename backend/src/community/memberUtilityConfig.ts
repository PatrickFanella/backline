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
