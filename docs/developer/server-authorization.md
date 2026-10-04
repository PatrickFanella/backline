# Server authorization and Discord login

The API and WebSocket server require an active bot installation and current Discord owner, Administrator or Manage Server permission for server data. Site roles do not grant access to another Discord server. API keys use the same server check as dashboard tokens. Discord failures deny access; revocation removes socket subscriptions before further data is delivered.

Dashboard login starts at `GET /api/auth/discord/start`. The backend sets an HTTP-only browser cookie and persists hashes of the browser nonce and OAuth state with a ten-minute expiry. The frontend sends both the returned code and state to `/api/auth/discord`. PostgreSQL atomically deletes the matching nonce before token exchange, so concurrent callbacks and replay cannot reuse it. Starting a new login replaces the browser cookie. Expired rows are removed when a new login starts.

Apply the additive `20261004190000_oauth_state` migration before starting this revision. Keep a tested database backup before upgrading an existing installation. Rolling back code does not require dropping the nonce table. Configure the registered Discord redirect URI to the frontend callback, and serve the API and frontend from the same site in production. Browser and refresh cookies use Secure in production; local HTTP development remains supported. Login requires the identify and guilds scopes. Discord token expiry follows the provider response.

New Discord users can sign in as the default USER role. `ADMIN_DISCORD_IDS` does not confer server permission; site administration uses the existing site-role controls. Global IP and user bans require the site ADMIN role. Server administrators still need current Discord permission and a confirmed bot installation.

Request logs omit query strings, and OAuth errors expose a fixed message. Never log OAuth request bodies, Axios error objects, tokens, codes or client secrets.

October 4, 2026 checks: 25 permission and authorization unit tests, 13 real-socket tests, four PostgreSQL isolation/nonce tests, all 177 frontend tests, both type checks and application builds passed. PostgreSQL checks include five concurrent callbacks, exactly one consumption, wrong-browser denial, replay denial and expiry. The disposable database ran on Kuznya. These checks do not establish hosted CI, browser OAuth authorization, live Discord permission revocation or sustained pilot operation.
