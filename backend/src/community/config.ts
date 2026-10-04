import { z } from 'zod';

export const id = z.string().regex(/^\d{17,20}$/);
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
