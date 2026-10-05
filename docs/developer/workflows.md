# Server workflows

The opt-in `workflows` module sends one channel message per configured rule after a member join, new provider event, or `/workflow run id:…` command. The dashboard edits up to ten rules and shows trigger decisions separately from durable job delivery. Rule IDs are unique lowercase letters, digits and hyphens, up to thirty-two characters. Messages allow only `{member}`, `{title}` and `{url}` substitutions; rendering performs no evaluation and Discord mentions are suppressed.

Provider rules can filter provider and case-insensitive title text. Join rules can require a member role, checked at reservation and again from current Discord membership at delivery. Filters must belong to the chosen trigger. Join rules require the operator’s Member Gateway intent. Bot joins are ignored. Workflows have no message-input trigger and their output cannot feed itself back into another rule.

Saving attributes every rule to the authenticated manager; submitted actor IDs are overwritten. Delivery requires that manager to remain eligible, retain Manage Server and access the destination, and the bot to retain View Channel and Send Messages. Join subjects must still belong to the server and see the destination. Changed or deleted rules invalidate queued work through a stored configuration fingerprint.

Runs and jobs are reserved together under the server lock. Provider-trigger reservation shares the provider event transaction, so an event and its workflow output cannot diverge on rollback. Event IDs deduplicate concurrent and recreated handlers. Each rule has a 10–86400-second cooldown and a fifty-action rolling daily limit. Cooldown/limit suppression stores a `SKIPPED` receipt, preventing a repeated event from becoming eligible after the cooldown. Triggers older than five minutes are ignored; action jobs expire after five minutes. Limits are one thousand retained runs per server plus the shared job capacity.

`/workflow cancel id:…` cancels a pending run and clears its content. Confirmed delivery stores a message receipt for restart readback. An uncertain send is held and cannot replay automatically. Terminal runs and receipts expire after thirty days; uncertain records are retained within the server bound. The module performs channel messages only; role changes, webhooks, scripts and email are outside this workflow version.

The legacy analytics rules remain separate from server workflows. Their unimplemented notification/email/Discord adapters now return failure, and matching executions report failed actions rather than claiming delivery from log messages. Legacy webhook behavior is unchanged.

## Qualification

Nine fresh PostgreSQL checks cover concurrent triggers, persisted cooldown suppression, concurrent delivery/recreated receipt readback, changed rules, uncertain sends, conditions, stale triggers, manager attribution, server isolation, actual worker delivery history and the rolling daily limit. The seven provider regression checks also pass after workflow trigger integration. The fresh database applies twenty migrations and creates seventy-two domain tables. Two dashboard checks cover saving without enabling/trusting an actor and distinguishing skipped triggers from uncertain delivery. Legacy condition/action checks, app builds and changed-file lint are also required for this change.

Hosted CI, real join/manual/provider workflow messages, a real bot restart and dashboard interaction in an owner session remain separate qualification gates. This feature does not turn the older global analytics rules into server-scoped workflows.
