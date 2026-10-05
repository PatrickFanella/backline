# Server leveling

Leveling is opt-in. `/xp profile` shows the caller's server XP; `/xp leaderboard` shows at most 25 members. The Servers dashboard configures message awards, exclusions, optional voice awards and role rewards. Its authorized `/guilds/:guildId/leveling` endpoint returns public profile fields only. Private message digest keys never leave the service.

Message awards require Guild Messages and Message Content intents. Bots, webhooks, excluded channels/roles and short messages earn no XP. The default award is 15 XP with a 60-second cooldown. A normalized message earns XP once per member and server in 24 hours. The service stores a keyed digest for that window and discards the text. Discord event IDs prevent repeated event delivery from awarding again. Events older than five minutes are rejected, including after ledger retention expires.

Level is `floor(sqrt(XP / 100))`; level 1 requires 100 XP and level 2 requires 400 XP. Message and voice cooldowns are independent. A transaction under the server advisory lock commits the grant, total and qualifying reward jobs together. Competing events cannot bypass the cooldown. Each server has a cap of 10,000 profiles and 100,000 retained grants; new awards stop at capacity until expiry frees space. XP stops before the two-billion ceiling.

Voice awards are disabled by default and require the Voice States intent. A member must remain eligible for a full minute. Bots and AFK channels are always excluded; deafened, muted and solo members are excluded by default. Channel or eligibility changes reset partial minutes for affected participants. Process restart resets partial minutes and awards no offline time. Earned totals remain in PostgreSQL. The sampler runs every 30 seconds and awards at most one minute per sample; missed samples do not create catch-up awards.

No role rewards are configured by default. Dashboard authors configuring rewards need current Manage Roles permission, in addition to server access. Enabling saved rewards through Discord checks that permission too. Delivery rechecks the configured role, current XP, membership, exclusions, bot permission and hierarchy. Only the basic chat/voice role permission allowlist is accepted. Managed roles, the everyone role, privileged roles and roles at or above the bot are rejected. Assignment is idempotent; after an uncertain delivery, reconciliation reads current membership before retrying. Reward jobs expire after seven days and never escalate permissions.

Inactive profiles expire after 90 days by default, configurable from one to 365 days. Their digests and grants are removed with the profile. Recent active totals survive grant-history expiry. Already assigned Discord roles remain assigned when profiles expire. The worker removes expired digests and performs bounded batches of 100 inactive profiles per server each minute. Modules stay disabled until a server administrator opts in.

## Delivery evidence

The additive migration creates three leveling tables and indexes, with database constraints on XP and grant values. It must run before starting the new bot or API. Older application revisions remain compatible with the expanded schema. The private pilot has not been promoted to this feature revision.

PostgreSQL checks cover competing writes, event idempotency, normalization/deduplication, cooldowns, exclusions, server isolation, atomic reward enqueue, hierarchy denial, role-delivery reconciliation, retention and API access denial. Voice-clock checks cover AFK, mute/deafen, solo presence, channel moves, departure, server isolation and restart reset. Dashboard tests cover saved configuration, reward authoring, server leaderboard display and rejected saves.

These checks establish source and local behavior. Natural human messages/voice, real role assignment, dashboard browser configuration, a full process restart and hosted CI remain qualification gates for E03.
