import { z } from 'zod';

export const workflowRule = z
    .object({
        id: z.string().regex(/^[a-z0-9-]{1,32}$/),
        actorId: z.string().regex(/^\d{17,20}$/),
        trigger: z.enum(['member_join', 'provider_event', 'manual']),
        channelId: z.string().regex(/^\d{17,20}$/),
        message: z
            .string()
            .trim()
            .min(1)
            .max(1500)
            .refine(
                (value) =>
                    !/[{}]/.test(
                        value.replace(/\{(?:member|title|url)\}/g, '')
                    ),
                'Unsupported placeholder'
            ),
        provider: z.enum(['any', 'twitch', 'youtube', 'rss']).default('any'),
        contains: z.string().max(100).default(''),
        requiredRole: z
            .string()
            .regex(/^\d{17,20}$/)
            .nullable()
            .default(null),
        cooldownSeconds: z.number().int().min(10).max(86400).default(60),
    })
    .strict()
    .refine(
        (rule) =>
            (rule.trigger === 'provider_event' ||
                (rule.provider === 'any' && !rule.contains)) &&
            (rule.trigger === 'member_join' || !rule.requiredRole),
        'Filters must match the selected trigger'
    );
export const workflowsConfig = z
    .object({ rules: z.array(workflowRule).max(10).default([]) })
    .strict()
    .refine(
        (value) =>
            new Set(value.rules.map((rule) => rule.id)).size ===
            value.rules.length,
        'Duplicate workflow IDs'
    );
