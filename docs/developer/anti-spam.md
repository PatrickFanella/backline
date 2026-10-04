# Anti-spam and join bursts

The `anti-spam` module starts in observation. Enable member, message and Message Content intents in both the operator environment and Discord developer portal, then restart before enabling it. Server setup configures message/mention thresholds, literal prohibited text, prohibited domains, role/channel exemptions, join thresholds, raid duration and timeout duration. Bots, the server owner, administrators and server managers are exempt.

Message burst windows are stored in PostgreSQL and survive restart. Duplicate Gateway event IDs do not count twice. Processing order does not determine which messages count in the recent window. Text matching is a normalized, case-insensitive substring match without user-authored regular expressions; domain matching includes subdomains but rejects suffix lookalikes. Source timestamps older than five minutes are ignored. No message content is stored in samples or decisions.

Join bursts activate a persistent, time-limited raid state. Subsequent joins are evaluated while that state is active. The dashboard shows decisions and current raid expiry, and lets a current server manager stop raid mode. Observation records decisions without Discord moderation. Tune thresholds and exemptions in the pilot before opting into enforcement.

Enforcement requires current Moderate Members permission when configuring it and an enabled `moderation` module. Each queued timeout checks the current policy hash, exemptions, actor/bot permission and target hierarchy. Changed policy cancels old decisions; disabled modules cancel jobs. Timeouts are capped at 60 minutes. Delivered cases record actual Discord outcomes; uncertain mutations remain held through the moderation case mechanism.

Samples expire after ten minutes; terminal decisions expire after 90 days. The bot's minute cleanup recovers interrupted decision-to-queue handoffs and expires records. Capacity is capped at 10,000 recent samples per server. History is scoped and includes the linked job's actual state, so a canceled action is not presented as delivered.

Eight content/PostgreSQL tests cover observation defaults, concurrent bursts, duplicate events, user isolation, exemptions, domain lookalikes, persistent raid state and policy-change cancellation. Dashboard tests verify observation defaults. Natural member traffic, timeout delivery and SUBCULT threshold tuning remain live qualification gates. Existing Discord AutoMod rules are preserved; this module does not claim native AutoMod rule provisioning.
