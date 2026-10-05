import { z } from 'zod';

export const id = z.string().regex(/^\d{17,20}$/);
export const giveawayConfig = z
    .object({
        maxActive: z.number().int().min(1).max(25).default(10),
        maxEntries: z.number().int().min(1).max(1000).default(500),
        retentionDays: z.number().int().min(1).max(90).default(30),
    })
    .strict();
export const ticketConfig = z
    .object({
        categoryId: id.optional(),
        panelChannelId: id.optional(),
        staffRoles: z.array(id).max(10).default([]),
        retentionDays: z.number().int().min(1).max(90).default(7),
        retainContent: z.boolean().default(false),
        maxOpen: z.number().int().min(1).max(100).default(25),
    })
    .strict()
    .refine(
        (value) => new Set(value.staffRoles).size === value.staffRoles.length,
        'Duplicate staff roles'
    );
export const auditKinds = [
    'member-join',
    'member-leave',
    'message-delete',
    'message-edit',
    'member-roles',
    'role-create',
    'role-delete',
    'moderation',
] as const;
export const auditConfig = z
    .object({
        channelId: id.optional(),
        events: z
            .array(z.enum(auditKinds))
            .max(8)
            .default([...auditKinds]),
        retainContent: z.boolean().default(false),
        retentionDays: z.number().int().min(1).max(90).default(7),
    })
    .strict();

export const onboardingConfig = z
    .object({
        channelId: id.optional(),
        departureChannelId: id.optional(),
        welcome: z.string().max(1800).default('Welcome {user} to {server}!'),
        departure: z.string().max(1800).default('{user} left {server}.'),
        joinRoles: z.array(id).max(10).default([]),
        requireRules: z.boolean().default(false),
        rules: z.string().max(1024).default(''),
    })
    .strict()
    .refine(
        (data) => !data.requireRules || (!!data.channelId && !!data.rules),
        'Rules acknowledgment requires a channel and rules'
    );

export const selfRolesConfig = z
    .object({
        channelId: id.optional(),
        title: z.string().min(1).max(100).default('Choose your roles'),
        style: z.enum(['buttons', 'select']).default('buttons'),
        roles: z
            .array(
                z
                    .object({
                        roleId: id,
                        label: z.string().min(1).max(80),
                        group: z.string().max(40).optional(),
                        requires: z.array(id).max(10).default([]),
                    })
                    .strict()
            )
            .max(20)
            .default([]),
    })
    .strict()
    .refine(
        (data) =>
            new Set(data.roles.map((role) => role.roleId)).size ===
            data.roles.length,
        'Duplicate roles'
    );

export const antiSpamConfig = z
    .object({
        observeOnly: z.boolean().default(true),
        messageLimit: z.number().int().min(2).max(100).default(6),
        windowSeconds: z.number().int().min(2).max(300).default(10),
        mentionLimit: z.number().int().min(1).max(100).default(5),
        prohibitedDomains: z
            .array(
                z
                    .string()
                    .trim()
                    .toLowerCase()
                    .regex(/^[a-z0-9.-]+$/)
                    .max(253)
            )
            .max(100)
            .default([]),
        prohibitedWords: z
            .array(z.string().trim().min(2).max(100))
            .max(100)
            .default([]),
        exemptRoles: z.array(id).max(50).default([]),
        exemptChannels: z.array(id).max(50).default([]),
        joinLimit: z.number().int().min(2).max(100).default(10),
        joinWindowSeconds: z.number().int().min(5).max(300).default(60),
        raidMinutes: z.number().int().min(1).max(60).default(10),
        timeoutMinutes: z.number().int().min(1).max(60).default(5),
    })
    .strict();
