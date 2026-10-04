# PostgreSQL migration baseline

The active migration directory now contains a PostgreSQL baseline matching the reviewed application schema. The original SQLite migration files remain unchanged under `backend/prisma/legacy-sqlite-migrations/`. Prisma must not attempt to apply those files to PostgreSQL.

## Fresh installation

Set `DATABASE_URL` through the existing secret configuration, then run:

```bash
rtk npm ci --prefix backend
rtk npm run prisma:generate --prefix backend
rtk npm run prisma:migrate --prefix backend
rtk npm run prisma:seed --prefix backend
```

## Existing PostgreSQL database

Preserve the current database and its migration-history table. Capture a recoverable backup and prove restoration against a separate database before changing history. The adoption tool compares the database to the immutable `backend/prisma/baseline.prisma` snapshot; it refuses drift and does not run schema-changing SQL.

```bash
rtk node scripts/adopt-postgresql-baseline.mjs
rtk node scripts/adopt-postgresql-baseline.mjs --write-history --backup-receipt /PRIVATE/PATH/restore-receipt.json
rtk npm run prisma:migrate --prefix backend
```

The first command only checks. The second records the baseline as applied after a matching schema check and requires an existing backup receipt. Receipt existence is an operator prerequisite, not an automated claim that the backup is restorable. Subsequent additive migrations run through the normal migration command. If schema drift is reported, reconcile it on an isolated copy and review the exact SQL before touching the original. Do not reset the database or delete migration history to force adoption.

## Existing SQLite database

The PostgreSQL-generated Prisma client cannot read SQLite by changing its URL. The old `scripts/migrate-to-postgres.ts` attempts this and is not a supported conversion path. Preserve the SQLite database and old migration history. A conversion requires a separately generated SQLite client or explicit SQLite reader, reviewed field/ID transformations and relational integrity checks on an isolated copy. Do not point the new migration directory at SQLite.

## Reproducible migration check

Provide `BASELINE_FRESH_DATABASE_URL` and `BASELINE_EXISTING_DATABASE_URL` for two distinct empty disposable databases. Run `rtk node scripts/check-postgresql-baseline.mjs`. The check migrates and seeds a fresh database, creates an existing-schema fixture without migration history, adopts the baseline and verifies that the fixture's row, clients and timestamp are unchanged. This check deliberately leaves its disposable databases intact for inspection; it never resets or drops a database.

## Server isolation upgrade

The next additive migration introduces `GuildInstallation`, per-server module configuration, and multiple user/server memberships. Existing `Guild` rows are copied into installation records before the foreign key is added. Installation records start inactive until the bot confirms its presence; an OAuth membership does not prove the bot is installed. Removing one user's membership leaves other administrators intact.

New presence events carry `guildId`. Existing unattributed rows retain `NULL` and remain outside server reports. Presence aggregation, client drift, activity analysis, and timelines filter by server. The application preserves account-wide privacy exports and deletion requests as account-wide operations.

The baseline check also verifies preservation of an existing membership through the additive migration. With a migrated disposable database, run `RUN_DATABASE_TESTS=true` and `DATABASE_URL` through the private environment, then execute `rtk npm test --prefix backend -- --runInBand __tests__/integration/database/guildIsolation.test.ts`. This test exercises two administrators, membership removal, two-server presence counts and exclusion of legacy events against PostgreSQL.
