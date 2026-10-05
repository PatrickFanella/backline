# Community reports and counters

The community-reports module collects observed message, join and departure events without message text. Bots and webhooks are excluded. Channel exclusions apply to message events. It uses Guild Messages and Guild Members intents; Message Content and presence intents are unnecessary. Collection is opt-in and independent of the older activity-analysis module.

The Servers dashboard requests a server-authorized report over a range of at most 90 days. Reports include totals, distinct members who sent messages, daily UTC trends, up to 100 channel totals and observed join cohorts. Queries always filter server ID and the requested time range. Event IDs are unique per server, so duplicate Gateway deliveries do not inflate totals. Departure events with a known join timestamp update the corresponding cohort; departures with an unknown timestamp suppress a retention-rate claim.

Coverage records connected collector samples at 30-second intervals, deduplicated by minute. Reports distinguish unavailable history, partial collection and a range with a sample in each minute. A covered range with no events reports observed zero; an unavailable range returns null totals. These samples establish collector observations, not exhaustive Discord history: permissions, Gateway gaps and collection startup can limit what the bot sees. Cohort retention is an observed measure and is unavailable when samples are missing or departure attribution is unknown.

Retention defaults to 30 days and is configurable from one to 90. The server can retain at most 100,000 observations; collection stops at capacity until expiry frees space. Coverage also stops at capacity. A collector permits at most 500 pending writes; capacity or write failure removes the corresponding minute from coverage. No message content or display names are stored in these report tables. Legacy activity histories remain separate and are preserved.

Administrators can configure at most five text or voice counter channels. Counters use observed messages, joins or departures over one to 30 days. A channel name includes its metric, window and observed count, such as `observed-messages-1d-42`. Setting counters requires current Manage Channels permission; delivery checks the bot's current channel permission and active server configuration. The counter scheduler uses the existing durable queue with one job per channel and interval. Intervals range from one hour to one day.

A database reservation consumes the interval before a rename attempt. Competing workers cannot both rename the channel. An uncertain rename is held for readback; matching the persisted expected name proves the desired channel state. A nonmatching name does not trigger another rename in that interval. At expiry, the job is cancelled with its unconfirmed outcome recorded, and the next interval may proceed. Expired completed/cancelled receipts follow the report retention policy.

The additive migration creates observations, coverage, cohort and counter-state tables. Run it before starting the new bot/API. Prior application versions remain compatible with the expanded schema. The private pilot has not been promoted to this feature.

## Qualification

Local PostgreSQL checks reconcile counts across servers and time windows, distinguish gaps from zero, deduplicate concurrent events, apply exclusions, enforce counter intervals, retain uncertain rename reservations, deny unavailable permissions and expired configuration, and enforce retention and API authorization. Dashboard tests cover unavailable history, partial reports and counter policy submission.

Natural Discord messages/joins/departures, actual channel renames, a real process restart, hosted CI and owner browser report setup remain live qualification gates for E04. Coverage samples and local fixtures do not close those gates.
