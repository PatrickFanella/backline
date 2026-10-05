# Private local pilot

Build the backend and dashboard with the same commit. Copy the tracked tree, backend build and generated dependencies, and frontend build into a separate, pinned directory. Workspace edits must not change a running pilot. Copy trusted operator plugins into `backend/dist/plugins` for the compiled backend layout; operator plugins remain disabled per server until configured.

Keep Discord credentials in the existing private environment file. Use a second private environment file for the pilot's database and session secrets. Files and the runtime directory must be accessible only to the owning user. Use a dedicated database role with access only to the pilot database. Keep both files outside Git and never include their values in receipts or logs.

`scripts/pilot/launch.cjs` takes `bot`, `api` or `migrate`, followed by environment file paths. Later files override earlier files. Set `HOST=127.0.0.1`, restrict `BOT_GUILD_IDS` to approved test servers, and enable only the Gateway intents approved for testing. New server modules start disabled. The dashboard can use `scripts/pilot/serve-dashboard.py` on loopback port 5173. Local HTTP OAuth uses the registered `http://localhost:5173/auth/callback` redirect.

Record the source commit, build hashes, migration list, service names, database owner and observation start time without secret values. Check actual command registration and Discord delivery separately from process health. A running local pilot does not establish public readiness, hosted CI, natural traffic, or a completed observation period.

Stop only the pilot's bot, API and dashboard units to roll back. Retain the database and private environment files, select the previous pinned bundle, and start the same units. Additive schema changes must remain compatible with the previous bundle. Test that procedure before claiming rollback qualification. The operator owns pilot secrets; retire the generated database and session credentials when the pilot ends. User-provided Discord credentials remain under the user's existing rotation policy.

## Database backup and restore check

Run `rtk proxy python scripts/pilot/backup.py` from the pinned source. Set `--directory` to a private directory with mode 700 when the default path is unsuitable. The utility accepts `--context`, `--container`, `--database`, `--database-user`, and `--restore-owner`, so it can verify a backup for the owned pilot or a release stack without hard-coded infrastructure names. For the existing pilot, its defaults target Docker context `kuznya`, container `backline-pilot-postgres`, database `backline_pilot`, and owner `backline_pilot`. It uses the selected container's local PostgreSQL connection; it does not read or print Discord credentials.

Each run captures a consistent SQL dump, stores a private manifest, restores into a newly named disposable database owned by `backline_pilot`, and compares every public table's rows and all captured sequence values with the dump. The manifest sorts COPY rows so PostgreSQL's physical row order does not affect the comparison. It drops only the disposable database successfully created by that run. An unsuccessful verification leaves the original backup available for inspection; recovery of any leftover disposable database requires checking the container before deletion.

A successful run retains the latest fourteen verified backup pairs. Failure evidence is preserved. The utility stops creating backups when retained SQL exceeds 896 MiB and rejects dumps larger than 64 MiB; review storage before increasing those pilot limits. Keep backup access restricted because SQL dumps can contain OAuth credentials and server data. This local volume is not an off-host disaster-recovery copy or point-in-time recovery.

Run `rtk proxy python -m unittest discover -s scripts/pilot -p test_backup.py` for parser and tamper checks. A restore receipt proves captured database data and sequence equality. It does not prove a Discord action, OAuth browser flow, application rollback, full schema equivalence, hosted CI, or sustained pilot operation.

## YouTube connection check, October 5, 2026 UTC

The private pilot runs pinned application commit `75278980d0b1d944e4703599a844df9ff70d56a2`. Both app builds passed before the update. The previous bot/API bundle, separate dashboard bundle, exact service units, runtime environment and a private SQL dump with SHA-256 receipt were retained. The pilot database advanced from fourteen to twenty-two additive migrations. The bot, API and dashboard are active; bot readiness was logged, `/health/ready` returned HTTP 200 with database/Redis/Discord checks passing, and the dashboard served `/servers`. These checks do not establish an authenticated owner browser flow or qualify all newly available modules.

The owner selected YouTube channels `UCEMcKWy0jWPIpkzFM_7nhsw` and `UCIueeoqtH2Tumd_AVqYcQOg`. Fresh Discord reads checked the current owner, destination access and bot send permissions before enabling integrations in server `947948179897327686`. Both feeds target the previously selected `audit-log` channel `1376747711654527066`. The `/feed` command was registered for that server. The saved operator key remains outside the repository; the private file has mode 600.

Both actual adapter reads returned zero public uploads. Initial polls persisted successful baselines without historical sends. A bounded operator probe made only these two feeds due; the running bot advanced both to the next fifteen-minute window with zero failures and no last error, preserving their baselines. Private receipts are `~/.local/state/backline/pilot-receipt.json`, `youtube-connections.json` and the two provider-read receipts. They contain configuration and proof boundaries without credential values.

No natural new-upload notification has been observed. Hosted CI, an owner-session dashboard check, application rollback, sustained observation and the other modules' live qualification remain separate gates. RSS still needs an owner-selected public source.
