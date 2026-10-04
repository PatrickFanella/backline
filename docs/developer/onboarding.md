# Member onboarding

Enable `onboarding` after setting `BOT_MEMBER_INTENTS=true`, enabling the member intent in Discord's developer portal and restarting the bot. Server setup configures welcome/departure destinations, text templates, up to ten join roles and optional rules acknowledgment. Templates support `{user}` and `{server}` names and disable mentions. Messages use embeds; an enabled rules policy adds a member-bound acknowledgment button.

Configuring join roles through the dashboard additionally requires current Manage Roles or Administrator permission, or server ownership. Delivery fetches current roles, bot permission and hierarchy. Eligible roles contain only basic chat/voice permissions; managed roles, the server's everyone role, privileged roles and roles at or above the bot are rejected. Role changes use individual additions, preserving unrelated roles. Unavailable roles are diagnosed separately from welcome delivery.

Each membership episode is keyed by server, user and Discord's join timestamp. Repeated joins reuse the same record and durable action. The worker checks the current join timestamp before delivery, so an old job cannot welcome or assign roles to a later membership. A leave records that episode's departure once. An uncached departure can use the most recent recorded episode; members who joined before this module recorded them have no departure record.

When rules acknowledgment is required, join roles wait. Only the intended member can acknowledge the stored welcome message. Current membership, module enablement and the displayed rules hash are checked; changed rules invalidate an old button. Acknowledgment queues a separate role action with fresh eligibility checks. Duplicate acknowledgments reuse that action. A successful acknowledgment does not claim that roles were delivered.

Send and role reservations hold uncertain operations rather than repeating them. The worker recovers interrupted capture-to-queue handoffs. Disable the module to cancel pending actions. Membership records expire after 90 days; history and actions exclude expired records and the bot cleans them up each minute. Discord messages already sent remain in their channels.

`GET /guilds/:guildId/modules/onboarding/history` returns the last 100 unexpired episodes to current server managers, including welcome/role/departure states and diagnostic details. The API and bot must share the migrated PostgreSQL database.

Five PostgreSQL tests cover concurrent joins, duplicate sends, stale membership, privileged roles, acknowledgment identity and rules changes, and uncertain delivery. Dashboard coverage verifies selected-server template and role saves. These checks use Discord fixtures. A real join, human rules acknowledgment and actual join-role assignment remain pilot qualification gates.

Live service qualification on October 4, 2026 used the existing bot member as an explicit fixture in server `947948179897327686`. The handler delivered welcome message `1556407349311176756`, added a temporary role with no permissions, and Discord readback confirmed both. The module was disabled and the temporary role/channel removed. This was not a natural join or human acknowledgment. Private evidence is stored under `~/.local/state/backline/pilot-20261004/onboarding-live-evidence.json`.
