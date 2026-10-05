import { z } from 'zod';

export const providerSource = z.discriminatedUnion('provider', [
    z
        .object({
            provider: z.literal('twitch'),
            source: z.string().regex(/^[a-z0-9_]{3,25}$/),
        })
        .strict(),
    z
        .object({
            provider: z.literal('youtube'),
            source: z.string().regex(/^UC[a-zA-Z0-9_-]{22}$/),
        })
        .strict(),
    z
        .object({
            provider: z.literal('rss'),
            source: z
                .string()
                .url()
                .max(1000)
                .refine((value) => {
                    const url = new URL(value);
                    return (
                        url.protocol === 'https:' &&
                        !url.username &&
                        !url.password &&
                        (!url.port || url.port === '443')
                    );
                }),
        })
        .strict(),
]);
export const integrationsConfig = z.object({}).strict();
export const feedInput = z
    .object({
        channelId: z.string().regex(/^\d{17,20}$/),
        ...{ subscription: providerSource },
    })
    .strict();
