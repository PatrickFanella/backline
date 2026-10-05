import { z } from 'zod';

// Original fictional objects. No externally sourced artwork is bundled.
export const economyCatalog = {
    cassette: { name: 'Demo cassette', price: 30 },
    ticket: { name: 'Backstage ticket', price: 40 },
    pin: { name: 'Enamel pin', price: 20 },
    zine: { name: 'Community zine', price: 25 },
    patch: { name: 'Jacket patch', price: 35 },
    poster: { name: 'Show poster', price: 45 },
    badge: { name: 'Crew badge', price: 50 },
    pass: { name: 'Festival pass', price: 100 },
} as const;
export const economyItemId = z.enum([
    'cassette',
    'ticket',
    'pin',
    'zine',
    'patch',
    'poster',
    'badge',
    'pass',
]);
export const economyConfig = z
    .object({
        currencyName: z
            .string()
            .trim()
            .min(1)
            .max(20)
            .regex(/^[\p{L}\p{N} _-]+$/u)
            .default('Credits'),
        dailyReward: z.number().int().min(1).max(1000).default(100),
        gamesEnabled: z.boolean().default(false),
        shopEnabled: z.boolean().default(false),
    })
    .strict();
