# Dashboard server setup

The signed-in landing page is now server setup. It lists only installed servers where the account currently has Discord owner, Administrator or Manage Server permission. The backend refreshes Discord memberships before listing them. A saved membership or site role is not enough to appear in the picker.

Choose a server, then enable or disable its modules. The page saves through the same versioned configuration store as `/settings` and reads the persisted record back before reporting success. Failed writes retain the displayed configuration and explain that the save failed. Server switching clears old module results, and late responses from a previous selection are ignored. Activity collection stays disabled when the operator has not enabled its Gateway intents. Use `/setup` inside Discord for current bot permission diagnostics.

Observed activity reports remain available under `/observed-activity`; the selected server is attached to server-data API requests. Site-wide user-ban data and filtering are hidden when the account cannot access them. A server authorization denial no longer triggers a token refresh or logs out a still-authenticated administrator.

The authenticated `GET /api/guilds` endpoint returns current manageable installations. Module settings remain under `/api/guilds/:guildId/modules`. Configuration, listing and event dispatch preserve the optional operator server restriction.

October 4, 2026 evidence: all 182 frontend tests passed, including five setup tests covering server selection, persisted saves, permission loss, no eligible servers and missing-intent controls. Fifteen authorization tests, both type checks, changed-file lint and frontend build passed. Browser inspection covered the 1280-pixel and 390-pixel layouts and enabling an extension through a fixture HTTP API. The fixture server was labeled as test data. The narrow-screen check exposed a pre-existing consent banner layout problem; its controls now stack below the text on narrow screens and the page reserves space beneath its footer.

The supplied OAuth secret successfully authenticated the confidential application with Discord, and the registered callback is `http://localhost:5173/auth/callback`. The embedded browser received HTTP 403 and Discord's temporary-network-error page on two login attempts. Browser consent, real module configuration in Discord, current permission-loss verification and API-to-live-bot action qualification remain open. Fixture browser checks do not establish these real-flow gates.
