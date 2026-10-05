# Deploy a Backline release

Use this guide to run one reviewed Backline release with `compose.release.yml`. The source of record and release review are in [Gitea](https://git.subcult.tv/subculture-collective/backline). A green Gitea CI run proves the checks that ran for that revision. It does not deploy the revision or prove Discord, browser, or provider delivery.

This guide does not run a deployment. Use it after the release revision has passed the required Gitea checks and an operator has selected the two immutable image digests.

## Prepare the release files

Keep both release environment files outside Git and readable only by the runtime operator. Create a private directory, then copy the tracked templates into it.

```bash
rtk proxy install -d -m 700 /srv/backline
rtk proxy install -m 600 release-example.env /srv/backline/release.env
rtk proxy install -m 600 release-runtime-example.env /srv/backline/runtime.env
```

Edit `/srv/backline/release.env` before using it.

- Set `BACKLINE_BACKEND_IMAGE` and `BACKLINE_FRONTEND_IMAGE` to image digests for the reviewed source revision. Do not use `latest` or a mutable branch tag.
- Set `BACKLINE_ENV_FILE` to `/srv/backline/runtime.env`.
- Generate a unique `POSTGRES_PASSWORD` and keep it in this private file.
- Keep `BACKLINE_BIND_ADDRESS=127.0.0.1` until a separately managed reverse proxy is ready to expose the dashboard.

Edit `/srv/backline/runtime.env` with the Discord credentials, session secrets, permitted origins, and optional provider credentials. Compose injects `DATABASE_URL`, `REDIS_URL`, `NODE_ENV`, and the per-process `BOT_RUN_JOBS` value; do not duplicate those settings in the runtime file.

The values in `release-runtime-example.env` are placeholders. They are not usable credentials.

## Build the dashboard with public values

Vite substitutes `VITE_*` values while the dashboard image is built. Docker runtime environment variables cannot change the compiled browser bundle.

Build the dashboard image with the public client configuration for the selected release. `VITE_DISCORD_CLIENT_ID`, `VITE_API_URL`, `VITE_ENVIRONMENT`, and `VITE_DISCORD_REDIRECT_URI` are supported build arguments. Treat every `VITE_*` value as public. Do not pass bot tokens, client secrets, JWT secrets, webhook URLs, or provider keys as a Vite build argument.

For example, a release-image build supplies values in this form before the image is pushed and its digest is recorded:

```bash
rtk proxy docker build \
  --build-arg VITE_DISCORD_CLIENT_ID=discord-application-id \
  --build-arg VITE_API_URL=https://backline.example.invalid/api \
  --build-arg VITE_ENVIRONMENT=production \
  --build-arg VITE_DISCORD_REDIRECT_URI=https://backline.example.invalid/auth/callback \
  --tag registry.example.invalid/backline/dashboard:release-candidate \
  frontend
```

Use the resulting digest, such as `registry.example.invalid/backline/dashboard@sha256:<digest>`, in `BACKLINE_FRONTEND_IMAGE`. Record the backend digest, frontend digest, and Gitea commit SHA together in the release receipt.

## Stage the release before production

Run the selected backend and dashboard digests with the production-shaped release files in a staging environment first. Complete the migration and verification commands in this guide there. Confirm the dashboard’s OAuth redirect URI and CORS origin match the stage URL, and perform a bounded bot action in an approved stage server.

Release qualification must bind its test receipts to the selected commit and image digests. Run the complete backend suite, the separate fresh PostgreSQL suite, baseline adoption and seed checks, and container startup and restore checks. A passing source build does not establish Gateway readiness or Discord delivery. Require the meaningful Gitea checks for the exact selected revision before deployment.

## Start the release

`compose.release.yml` starts six services. It has one `bot` replica. Do not scale that service: it owns the Discord Gateway session and the durable job worker.

| Service     | Role                                            | Startup condition                                         |
| ----------- | ----------------------------------------------- | --------------------------------------------------------- |
| `postgres`  | Persistent Backline database                    | PostgreSQL health check                                   |
| `redis`     | Persistent Redis state                          | Redis ping health check                                   |
| `migrate`   | One-shot migration and permission/template seed | Runs after PostgreSQL is healthy                          |
| `api`       | HTTP API                                        | Runs with `BOT_RUN_JOBS=false` after migration completion |
| `bot`       | Discord Gateway and durable jobs                | Runs with `BOT_RUN_JOBS=true` after migration completion  |
| `dashboard` | Nginx-served compiled dashboard                 | Runs after API health is available                        |

The migration service applies Prisma migrations and idempotently seeds the standard permissions and rule templates. Run it before replacing the long-running services. This makes the migration barrier explicit during an upgrade.

```bash
rtk proxy docker compose --env-file /srv/backline/release.env -f compose.release.yml config --quiet
rtk proxy docker compose --env-file /srv/backline/release.env -f compose.release.yml pull
rtk proxy docker compose --env-file /srv/backline/release.env -f compose.release.yml up -d postgres redis
rtk proxy docker compose --env-file /srv/backline/release.env -f compose.release.yml run --rm --no-deps migrate
rtk proxy docker compose --env-file /srv/backline/release.env -f compose.release.yml up -d --no-deps api bot dashboard
```

If the migration command fails, leave `api`, `bot`, and `dashboard` on the prior release. Inspect the migration error and database state before retrying. A clean `docker compose up` also encodes the migration completion dependency for first boot.

## Verify the running release

Check each service before calling the release ready.

```bash
rtk proxy docker compose --env-file /srv/backline/release.env -f compose.release.yml ps
rtk proxy docker compose --env-file /srv/backline/release.env -f compose.release.yml exec api wget -q -O - http://127.0.0.1:3001/health/live
rtk proxy docker compose --env-file /srv/backline/release.env -f compose.release.yml exec api wget -q -O - http://127.0.0.1:3001/health/ready
rtk proxy docker compose --env-file /srv/backline/release.env -f compose.release.yml exec bot node scripts/bot-health.cjs
rtk proxy docker compose --env-file /srv/backline/release.env -f compose.release.yml exec dashboard wget -q -O - http://127.0.0.1/health
```

The API readiness endpoint checks PostgreSQL, Redis, and the Discord Gateway HTTP endpoint. The bot check reads `/tmp/backline-bot-ready.json`; the bot writes it every 15 seconds after Discord startup. Docker marks the bot unhealthy if that file is missing, reports `ready: false`, or is older than one minute.

Inspect the bot logs and complete a bounded Discord action check in an approved server. A healthy process proves neither command delivery nor an owner browser session.

```bash
rtk proxy docker compose --env-file /srv/backline/release.env -f compose.release.yml logs --since=5m bot api dashboard
```

## Back up before migration

Run the backup utility from the pinned release tree before each migration. It needs the Docker context, PostgreSQL container name, source database, login role, and owner for its disposable restore database.

```bash
rtk proxy python scripts/pilot/backup.py \
  --context release-host \
  --container backline-postgres-1 \
  --database backline \
  --database-user backline \
  --restore-owner backline \
  --directory /srv/backline/backups
```

Use the actual Docker context and Compose-created PostgreSQL container name for the host. The destination directory must be private and must not be a symlink. The utility captures a SQL dump, restores it into a new disposable database, compares public-table data and captured sequence values, then writes a private receipt. It retains the latest fourteen verified backup pairs and preserves failed-run evidence.

A successful receipt proves that captured data and sequence values matched the disposable restore. It does not prove application rollback, off-host recovery, point-in-time recovery, Discord delivery, or an authenticated browser flow.

## Roll back with compatible schema

Record the prior backend digest, frontend digest, release environment file checksum, migration list, and backup receipt before upgrading. To roll back an application release, restore those two image digests in `/srv/backline/release.env`, then repeat the verification commands.

Do this only when the current database schema remains compatible with the prior application. Do not downgrade the database just because an image is rolled back.

Database rollback is destructive. Before restoring database data, define the recovery scope, stop every writer, capture a verified backup of the current database, and verify the target restore in a disposable database. Restore data only after an operator has reviewed the migration compatibility and recovery plan.

## Retire obsolete deployment paths

`docker-compose.prod.yml` is a legacy source-build stack. It does not define the Backline migration barrier, one-bot release topology, immutable image selection, or Vite build-time release configuration. Do not use it for this release path.

`.github/workflows/deploy.yml` contains placeholder deployment steps. `.github/workflows/deploy-production.yml` describes an older GitHub Container Registry, AWS, and EKS path. Both workflows are manual-only legacy routes with no automatic push trigger. Do not dispatch either workflow unless its infrastructure is separately rebuilt and qualified. They do not authorize a Backline deployment.

Gitea consumes the repository action workflows for CI. Build, image publication, deployment approval, and runtime verification remain separate operator steps until an audited Gitea release workflow exists.
