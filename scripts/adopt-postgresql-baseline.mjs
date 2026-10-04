import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const prisma = `${root}backend/node_modules/.bin/prisma`;
const baseline = '20261004000000_postgresql_baseline';

function run(args, allowedCodes = [0]) {
    const result = spawnSync(prisma, args, {
        cwd: `${root}backend`,
        encoding: 'utf8',
    });
    if (!allowedCodes.includes(result.status)) {
        // Prisma output can contain connection strings. Do not echo it.
        throw new Error(
            `Prisma ${args[0]} ${args[1]} failed (exit ${result.status}). Inspect schema drift using the documented private workflow.`
        );
    }
    return result.status;
}

const database = new URL(process.env.DATABASE_URL ?? '');
if (!['postgres:', 'postgresql:'].includes(database.protocol)) {
    throw new Error(
        'DATABASE_URL must select PostgreSQL. SQLite conversion is a separate operation.'
    );
}

const status = run(
    [
        'migrate',
        'diff',
        '--from-url',
        database.toString(),
        '--to-schema-datamodel',
        `${root}backend/prisma/baseline.prisma`,
        '--exit-code',
    ],
    [0, 2]
);
if (status === 2)
    throw new Error(
        'Schema differs from the PostgreSQL baseline. No migration history was changed.'
    );

if (process.argv.includes('--write-history')) {
    const receiptIndex = process.argv.indexOf('--backup-receipt');
    const receipt =
        receiptIndex === -1 ? undefined : process.argv[receiptIndex + 1];
    if (!receipt || !existsSync(receipt))
        throw new Error(
            'Provide --backup-receipt PATH for a verified recoverable backup before changing migration history.'
        );
    run([
        'migrate',
        'resolve',
        '--schema',
        `${root}backend/prisma/schema.prisma`,
        '--applied',
        baseline,
    ]);
    console.log(
        'Recorded PostgreSQL baseline. Existing application rows were not rewritten.'
    );
} else {
    console.log(
        'Schema matches the PostgreSQL baseline. Check only; migration history was not changed.'
    );
}
