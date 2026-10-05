import { z } from 'zod';

export const recoveryConfig = z
    .object({
        scheduled: z.boolean().default(false),
        intervalHours: z.number().int().min(24).max(168).default(24),
        retainDays: z.number().int().min(7).max(90).default(30),
        protectedChannelIds: z
            .array(z.string().regex(/^\d{17,20}$/))
            .max(50)
            .default([]),
        protectedRoleIds: z
            .array(z.string().regex(/^\d{17,20}$/))
            .max(50)
            .default([]),
    })
    .strict();
const snowflake = z.string().regex(/^\d{17,20}$/);
const bits = z.string().regex(/^\d{1,24}$/);
export const structureSchema = z
    .object({
        version: z.literal(1),
        guildId: snowflake,
        name: z.string().max(100),
        capturedAt: z.string().datetime(),
        roles: z
            .array(
                z
                    .object({
                        id: snowflake,
                        name: z.string().max(100),
                        color: z.number().int(),
                        permissions: bits,
                        position: z.number().int(),
                        managed: z.boolean(),
                        hoist: z.boolean(),
                        mentionable: z.boolean(),
                    })
                    .strict()
            )
            .max(500),
        channels: z
            .array(
                z
                    .object({
                        id: snowflake,
                        name: z.string().max(100),
                        type: z.number().int(),
                        parentId: snowflake.nullable(),
                        position: z.number().int(),
                        topic: z.string().max(4096).nullable(),
                        nsfw: z.boolean(),
                        bitrate: z.number().int().nullable(),
                        userLimit: z.number().int().nullable(),
                        rateLimitPerUser: z.number().int(),
                        overwrites: z
                            .array(
                                z
                                    .object({
                                        id: snowflake,
                                        type: z.number().int().min(0).max(1),
                                        allow: bits,
                                        deny: bits,
                                    })
                                    .strict()
                            )
                            .max(1000),
                    })
                    .strict()
            )
            .max(500),
    })
    .strict();
