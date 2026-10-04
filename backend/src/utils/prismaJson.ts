import { Prisma } from '@prisma/client';
import { z } from 'zod';

/** Validate external JSON and distinguish JSON null from SQL NULL. */
export function toInputJson(
    value: unknown
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    const parsed = z.json().parse(value);
    return parsed === null ? Prisma.JsonNull : parsed;
}
