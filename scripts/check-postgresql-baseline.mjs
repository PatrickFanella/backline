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
    await client.$executeRaw`INSERT INTO "PresenceEvent" ("id", "userId", "username", "clients") VALUES ('baseline-preserved', 'member', 'Member', ARRAY['desktop', 'web'])`;
    const [fixture] =
        await client.$queryRaw`SELECT "id", "userId", "username", "clients", "createdAt" FROM "PresenceEvent" WHERE "id" = 'baseline-preserved'`;
    await client.$executeRaw`INSERT INTO "User" ("id", "discordId", "username", "discriminator", "verified", "accessToken", "refreshToken", "accessTokenExpiresAt", "lastSeenAt", "updatedAt") VALUES ('baseline-admin', 'baseline-admin', 'Admin', '0', true, 'fixture', 'fixture', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
    await client.$executeRaw`INSERT INTO "Guild" ("id", "guildId", "name", "owner", "permissions", "userId") VALUES ('baseline-membership', '123456789', 'Legacy server', true, 8, 'baseline-admin')`;
    const [membership] =
        await client.$queryRaw`SELECT "id", "guildId", "name", "owner", "permissions", "userId" FROM "Guild" WHERE "id" = 'baseline-membership'`;
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
    const [after] =
        await client.$queryRaw`SELECT "id", "userId", "username", "clients", "createdAt" FROM "PresenceEvent" WHERE "id" = 'baseline-preserved'`;
    assert.deepEqual(after, fixture);
    const [membershipAfter] =
        await client.$queryRaw`SELECT "id", "guildId", "name", "owner", "permissions", "userId" FROM "Guild" WHERE "id" = 'baseline-membership'`;
    assert.deepEqual(membershipAfter, membership);
    assert.equal(await client.presenceEvent.count(), 1);
    assert.equal(
        (
            await client.guildInstallation.findUniqueOrThrow({
                where: { guildId: '123456789' },
            })
        ).active,
        false
    );
    assert.equal(
        (
            await client.presenceEvent.findUniqueOrThrow({
                where: { id: fixture.id },
            })
        ).guildId,
        null
    );
    console.log(
        'Fresh migrate/seed and existing-schema adoption passed; fixture row, clients and timestamp preserved.'
    );
} finally {
    await client.$disconnect();
}
