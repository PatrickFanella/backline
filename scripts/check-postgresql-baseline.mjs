import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const prisma = `${root}backend/node_modules/.bin/prisma`;
const fresh = process.env.BASELINE_FRESH_DATABASE_URL;
const existing = process.env.BASELINE_EXISTING_DATABASE_URL;
assert(
    fresh && existing && fresh !== existing,
    'Provide two distinct, empty, disposable PostgreSQL databases.'
);

function run(command, args, database) {
    const result = spawnSync(command, args, {
        cwd: `${root}backend`,
        env: { ...process.env, DATABASE_URL: database },
        encoding: 'utf8',
    });
    assert.equal(
        result.status,
        0,
        `${args[0]} failed; inspect the disposable database privately.`
    );
}

run(prisma, ['migrate', 'deploy'], fresh);
run(
    process.execPath,
    [`${root}backend/node_modules/ts-node/dist/bin.js`, 'prisma/seed.ts'],
    fresh
);
run(
    prisma,
    [
        'db',
        'execute',
        '--schema',
        `${root}backend/prisma/schema.prisma`,
        '--file',
        `${root}backend/prisma/migrations/20261004000000_postgresql_baseline/migration.sql`,
    ],
    existing
);

const { PrismaClient } = await import(
    '../backend/node_modules/@prisma/client/default.js'
);
const client = new PrismaClient({ datasources: { db: { url: existing } } });
try {
    await client.presenceEvent.create({
        data: {
            id: 'baseline-preserved',
            userId: 'member',
            username: 'Member',
            clients: ['desktop', 'web'],
        },
    });
    const fixture = await client.presenceEvent.findUniqueOrThrow({
        where: { id: 'baseline-preserved' },
    });
    const dir = mkdtempSync(`${tmpdir()}/spywatcher-baseline-`);
    const receipt = `${dir}/fixture-recovery.json`;
    // Logical fixture export is the recovery artifact for this disposable check.
    writeFileSync(receipt, JSON.stringify(fixture));
    run(
        process.execPath,
        [`${root}scripts/adopt-postgresql-baseline.mjs`],
        existing
    );
    run(
        process.execPath,
        [
            `${root}scripts/adopt-postgresql-baseline.mjs`,
            '--write-history',
            '--backup-receipt',
            receipt,
        ],
        existing
    );
    run(prisma, ['migrate', 'deploy'], existing);
    assert.deepEqual(
        await client.presenceEvent.findUniqueOrThrow({
            where: { id: fixture.id },
        }),
        fixture
    );
    assert.equal(await client.presenceEvent.count(), 1);
    console.log(
        'Fresh migrate/seed and existing-schema adoption passed; fixture row, clients and timestamp preserved.'
    );
} finally {
    await client.$disconnect();
}
