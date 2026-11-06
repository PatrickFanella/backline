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

Gitea consumes the repository action workflows for CI. The full six-service
Compose release still requires separate image selection, deployment admission
and runtime verification. The native dependency workflow below updates the
existing Dozor services within its narrower source and package contract.

## Native Dozor dependency candidate

The existing Dozor API and Discord bot run from separate native release trees.
`Backend CI` now builds a source-bound dependency candidate after backend quality
and PostgreSQL integration checks pass. It packages the seven reviewed JavaScript
dependency updates from `backend/package-lock.json`, verifies their npm integrity
hashes and package identities, and rejects install hooks, native builds, unsafe
archive paths, links and oversized archives. Its manifest records the commit,
runtime source, Prisma schema and migration hashes. CI extracts the transport
image and compares every packaged byte before retaining it as an artifact.

This candidate contains dependencies and a manifest, with no runtime credentials
or service launcher. It does not activate either native service. Native admission
must still compare both installed dependency graphs and source contracts, verify
the existing restore receipt, and retain rollback graphs before replacing any
package. The current bot launcher, private configuration and resume timer require
separate activation and recovery checks. Keep these checks in the deployment
path for automatic native activation; do not run the six-service
Compose release over the existing native units.

## Automatic native dependency updates

`Qualify and deploy native dependencies` builds and compares the transport
payload on pull requests. On Gitea pushes to `main`, it sends that image to Dozor
through a restricted SSH key. The host accepts only the current main revision
and the fixed `runtime` artifact. Before activation it requires all twelve main
quality, test, audit, image and candidate checks to pass. It fetches main into its
own source cache and compares the payload's lockfile, source contract and npm
integrity hashes with that trusted source.

The operator-owned host profile pins both native release trees, compiled files,
launchers, private configuration hashes and systemd units. Source changes,
unreviewed package changes, major upgrades and downgrades fail admission. The
existing bot's four HTTP-server source differences are recorded explicitly;
those files are outside its bot entry point. The API source must match main.
The worker checks a verified native restore receipt no older than 26 hours and
its dump checksum. It does not run migrations, create a new production stack or
invoke backup retention.

The worker copies each installed dependency graph and replaces only the seven
reviewed packages. It keeps nested dependencies and verifies the copied graph
before staging. The API's shared symlink target remains untouched. After a
second freshness and configuration check, it pauses the bot resume timer, stops
the two services, exchanges their graph entries atomically and replaces their
lockfiles. It starts the API, waits for its HTTP readiness endpoint, and then
starts the bot, whose native pre-start check needs that API listener. It requires
API readiness plus a fresh,
ready Discord heartbeat before recording success and resuming the timer.

Systemd owns the transaction after SSH disconnects. Its `ExecStopPost` restores
an incomplete transaction after failure or process termination; the registered
recovery service restores interrupted graph entries before the native units
start at boot. Owned drop-ins make the API and bot require that
recovery service to succeed; their original unit files stay unchanged. Previous
graphs, symlink targets, locks and private receipts are
retained. Failed readiness also restores the previous graphs and verifies the
restarted services, using the same API-ready-before-bot sequence. A retained failed transaction requires inspection before a
retry; CI does not discard recovery evidence.

The host profile, pinned source installation and enabled recovery unit must be
registered before main activation. CI uses only `HOMELAB_NATIVE_DEPLOY_KEY` and
`HOMELAB_NATIVE_KNOWN_HOSTS`; application and provider credentials stay in their
existing native files. This lane updates native dependencies. The dashboard
needs its own image deployment lane, and full Discord actions, voice delivery
and authenticated browser qualification remain separate checks.

## Automatic dashboard deployment

The dashboard image job follows native dependency admission. Frontend pushes
therefore run the backend qualification gates too; unchanged native graphs are
verified without restarting the API or bot. The dashboard build uses the four
public production values already embedded in the live app: client ID
`1375864689577164911`, API prefix `/api`, production mode and callback
`https://backline.subcult.tv/auth/callback`. Node and nginx bases are pinned by
registry digest. The image records its source revision, serves an uncached
`/build-info.json`, and denies source maps.

CI starts the actual image, compares every served file with its image bytes,
checks metadata and private-route noindex headers, and requires source maps to
return 404. A separate restricted key receives only the current main dashboard
image. The host guard requires the native transaction for that same revision to
have succeeded, verifies both native dependency locks and readiness, and checks
the original nginx configuration plus its single marker-route addition.

The existing Docker-run dashboard requires a one-time Compose baseline
migration. Receive and qualify the main image before replacing that service.
Retain the old container, static directory and configuration; the new baseline
embeds the accepted static payload and references the reviewed native proxy
configuration with the marker route added. Keep its host-network listener,
proxy targets, startup, resources and logging settings. The native health URL is
`/healthz` on its registered listener, so the baseline overrides the portable
image's `/health` healthcheck. The app's API, bot and data services stay outside
this Compose project.

Main CI waits up to five minutes for the registered baseline's Compose labels,
health and runtime guard. Once adopted, it promotes through the shared receiver
and verifies the image-backed public marker. Later pushes use the same lane
without another migration. CI uses `HOMELAB_WEB_DEPLOY_KEY` and
`HOMELAB_WEB_KNOWN_HOSTS`; application secrets are absent from the dashboard
image and its CI inputs. Independent public/source byte comparison and the
native health/data-boundary checks complete the rollout.
