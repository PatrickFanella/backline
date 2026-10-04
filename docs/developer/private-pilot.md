# Private local pilot

Build the backend and dashboard with the same commit. Copy the tracked tree, backend build and generated dependencies, and frontend build into a separate, pinned directory. Workspace edits must not change a running pilot. Copy trusted operator plugins into `backend/dist/plugins` for the compiled backend layout; operator plugins remain disabled per server until configured.

Keep Discord credentials in the existing private environment file. Use a second private environment file for the pilot's database and session secrets. Files and the runtime directory must be accessible only to the owning user. Use a dedicated database role with access only to the pilot database. Keep both files outside Git and never include their values in receipts or logs.

`scripts/pilot/launch.cjs` takes `bot`, `api` or `migrate`, followed by environment file paths. Later files override earlier files. Set `HOST=127.0.0.1`, restrict `BOT_GUILD_IDS` to approved test servers, and enable only the Gateway intents approved for testing. New server modules start disabled. The dashboard can use `scripts/pilot/serve-dashboard.py` on loopback port 5173. Local HTTP OAuth uses the registered `http://localhost:5173/auth/callback` redirect.

Record the source commit, build hashes, migration list, service names, database owner and observation start time without secret values. Check actual command registration and Discord delivery separately from process health. A running local pilot does not establish public readiness, hosted CI, natural traffic, or a completed observation period.

Stop only the pilot's bot, API and dashboard units to roll back. Retain the database and private environment files, select the previous pinned bundle, and start the same units. Additive schema changes must remain compatible with the previous bundle. Test that procedure before claiming rollback qualification. The operator owns pilot secrets; retire the generated database and session credentials when the pilot ends. User-provided Discord credentials remain under the user's existing rotation policy.
