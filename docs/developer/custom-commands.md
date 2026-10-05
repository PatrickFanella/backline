# Custom replies and utility time handling

The custom-commands module is opt-in and needs no privileged Gateway intents. Server managers configure up to 20 commands in the Servers dashboard. Members use `/custom name` to request a reply or `/custom` to list commands available to their current roles. All replies are ephemeral: they appear only to the caller. Commands can contain text, an embed title and an embed description. With required roles configured, the member must currently hold at least one; an empty role list allows all current members.

Templates support only `{user}`, `{server}` and `{channel}` name substitutions. No template is evaluated as code. Unknown substitutions and unsupported configuration fields are rejected. Literal code is ordinary text. Replies always disable user, role and everyone mentions, including mentions introduced by names. Expanded text and embed fields are bounded to Discord limits. The module rechecks installation/module state, current membership and roles, and revoked application access before replying. Configuration continues to use the existing server-authorized module endpoint.

The utility time resolver accepts a local date/minute, an IANA time zone and an explicit ambiguity policy. It rejects invalid calendar dates and nonexistent local times. Repeated local minutes default to rejection; choosing `earlier` or `later` selects the corresponding UTC instant. It uses the runtime's IANA/ICU data and does not depend on the host's configured time zone. This resolver is preparation for reminders and scheduled announcements; this PR does not expose those scheduling flows yet.

## Delivery evidence and remaining E05 scope

Local checks cover fixed substitutions, inert literal code, unknown/executable substitution denial, expanded response bounds, configuration limits and duplicate names. Time checks cover UTC, fractional offsets, a missing spring-forward minute, a repeated fall-back minute, invalid dates and unknown zones. PostgreSQL interaction fixtures check role loss, server isolation, disabled modules and revoked application accounts. Dashboard tests check text/embed/role submission, removal and rejected saves.

No database migration is needed: commands use the existing server-module JSON configuration. The private pilot has not been promoted to this revision and its registered slash commands have not been changed. A natural Discord invocation and owner browser setup remain qualification gates.

This implements the custom-command part of E05. Reminders, scheduled announcements, polls, suggestions, AFK state and birthdays remain unfinished. Their durable scheduling and delivery evidence must be added before E05 can be qualified or closed.
