# Private local pilot

Build the backend and dashboard with the same commit. Copy the tracked tree, backend build and generated dependencies, and frontend build into a separate, pinned directory. Workspace edits must not change a running pilot. Copy trusted operator plugins into `backend/dist/plugins` for the compiled backend layout; operator plugins remain disabled per server until configured.

Keep Discord credentials in the existing private environment file. Use a second private environment file for the pilot's database and session secrets. Files and the runtime directory must be accessible only to the owning user. Use a dedicated database role with access only to the pilot database. Keep both files outside Git and never include their values in receipts or logs.

`scripts/pilot/launch.cjs` takes `bot`, `api` or `migrate`, followed by environment file paths. Later files override earlier files. Set `HOST=127.0.0.1`, restrict `BOT_GUILD_IDS` to approved test servers, and enable only the Gateway intents approved for testing. New server modules start disabled. The dashboard can use `scripts/pilot/serve-dashboard.py` on loopback port 5173. Local HTTP OAuth uses the registered `http://localhost:5173/auth/callback` redirect.

Record the source commit, build hashes, migration list, service names, database owner and observation start time without secret values. Check actual command registration and Discord delivery separately from process health. A running local pilot does not establish public readiness, hosted CI, natural traffic, or a completed observation period.

Stop only the pilot's bot, API and dashboard units to roll back. Retain the database and private environment files, select the previous pinned bundle, and start the same units. Additive schema changes must remain compatible with the previous bundle. Test that procedure before claiming rollback qualification. The operator owns pilot secrets; retire the generated database and session credentials when the pilot ends. User-provided Discord credentials remain under the user's existing rotation policy.

## Database backup and restore check

Run `rtk proxy python scripts/pilot/backup.py` from the pinned source, or use `--directory` with a private directory (mode 700). This pilot-specific utility targets only the `backline-pilot-postgres` container in Docker context `kuznya` and database `backline_pilot`. It uses the container's local PostgreSQL connection; it does not read or print Discord credentials.

Each run captures a consistent SQL dump, stores a private manifest, restores into a newly named disposable database owned by `backline_pilot`, and compares every public table's rows and all captured sequence values with the dump. The manifest sorts COPY rows so PostgreSQL's physical row order does not affect the comparison. It drops only the disposable database successfully created by that run. An unsuccessful verification leaves the original backup available for inspection; recovery of any leftover disposable database requires checking the container before deletion.

A successful run retains the latest fourteen verified backup pairs. Failure evidence is preserved. The utility stops creating backups when retained SQL exceeds 896 MiB and rejects dumps larger than 64 MiB; review storage before increasing those pilot limits. Keep backup access restricted because SQL dumps can contain OAuth credentials and server data. This local volume is not an off-host disaster-recovery copy or point-in-time recovery.

Run `rtk proxy python -m unittest discover -s scripts/pilot -p test_backup.py` for parser and tamper checks. A restore receipt proves captured database data and sequence equality. It does not prove a Discord action, OAuth browser flow, application rollback, full schema equivalence, hosted CI, or sustained pilot operation.
