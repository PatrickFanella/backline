# AFK and birthday sharing

Both modules start disabled. `afk` requires Guild Messages; `birthdays` requires Guild Members. The bot checks current server membership and application-account status before reading or sending a shared notice. Member notices suppress notification mentions.

## Temporary away status

Members use `/afk set reason` with an optional expiry of one to twenty-four hours. Reasons are public to server members and limited to 160 characters. `/afk clear` removes the status; `/afk status member` reads a current shared status. A new message clears its author’s status, while a delayed older message cannot clear a status set after that message. The feature reads author and mention metadata and does not need message content.

A message mentioning away members reserves at most five notices. A member’s notice is throttled for thirty seconds. Durable notice jobs prevent duplicate Gateway events from repeating the same message. Delivery rechecks the destination and mentioned members’ visibility, and omits expired or withdrawn status. Failed or lost sends remain held rather than replaying. Expiry deletes stored reasons. A server can retain at most one thousand away statuses.

## Birthday consent and calendar

Managers choose a birthday text channel, IANA time zone, greeting hour and February 29 fallback in Server setup. Members explicitly opt in with `/birthday set month day share:true`. No birth year or age is collected. `/birthday status` reads only the requester’s settings. `/birthday remove` remains usable after module disablement, deletes the profile and cancels pending greetings. Member departure removes AFK and birthday records.

The scheduler reserves one greeting per member per local calendar year, including across competing scheduler passes and worker recreation. It catches up only within the current local birthday date. Delivery verifies current sharing, date, destination and member visibility. February 29 uses the configured February 28 or March 1 fallback in nonleap years. Server scans rotate in batches so later servers are not starved. A server can retain at most one thousand birthday profiles and one thousand combined member-notice actions, subject to the shared active-job limit.

Completed, failed and cancelled notice receipts and their attempts expire after thirty-two days. Uncertain outcomes remain held within the cap. Removing a profile stops later sends but cannot remove a greeting already delivered to Discord. Local profile deletion and Discord message history are separate controls.

PostgreSQL checks cover duplicate mention events, speech clearing, delayed messages, reason expiry, server isolation, explicit consent, calendar validation, annual deduplication and consent withdrawal. Calendar checks cover UTC date boundaries and leap days. Natural Discord activity, annual scheduling and member-removal events remain qualification gates.
