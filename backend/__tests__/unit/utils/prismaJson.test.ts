import { Prisma } from '@prisma/client';

import { toInputJson } from '../../../src/utils/prismaJson';

describe('Prisma JSON boundary', () => {
    it('distinguishes JSON null and preserves nested JSON', () => {
        expect(toInputJson(null)).toBe(Prisma.JsonNull);
        expect(toInputJson({ nested: [null, true, 2, 'value'] })).toEqual({
            nested: [null, true, 2, 'value'],
        });
    });

    it('rejects values PostgreSQL JSON cannot represent', () => {
        expect(() => toInputJson({ value: undefined })).toThrow();
        expect(() => toInputJson({ value: BigInt(1) })).toThrow();
    });
});
