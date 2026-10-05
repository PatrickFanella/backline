import { z } from 'zod';

import { somaStations } from './stations';

export const stationId = z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/)
    .refine(
        (value) => Object.prototype.hasOwnProperty.call(somaStations, value),
        'Unknown published SomaFM station'
    );
export const audioConfig = z
    .object({
        clipsEnabled: z.boolean().default(false),
        queuesEnabled: z.boolean().default(false),
        defaultStation: stationId.default('defcon'),
        djRoles: z
            .array(z.string().regex(/^\d{17,20}$/))
            .max(10)
            .default([]),
        volume: z.number().int().min(0).max(100).default(25),
        maxMinutes: z.number().int().min(1).max(120).default(30),
        idleSeconds: z.number().int().min(10).max(300).default(60),
    })
    .strict();
