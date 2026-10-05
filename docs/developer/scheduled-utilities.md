# Scheduled channel utilities

The opt-in `scheduled-utilities` module adds `/remind create|list|cancel` and `/announce create|list|cancel`. Create the event in its destination text or announcement channel. Reminders require the requester to retain channel access and permission to send messages. Announcements require current Manage Server permission. Backline rechecks membership, application-account status, module installation and channel permissions at delivery.

The `time` argument is `YYYY-MM-DDTHH:mm`; `timezone` is an IANA zone. Nonexistent daylight-saving times are rejected. Repeated times require an explicit `ambiguity:earlier` or `ambiguity:later`. One-time events must be at least ten seconds in the future and no more than thirty days away. Delivery has a one-day expiry window. Recurring announcements use the series commands below.

Reminders mention only their requester. Announcement content cannot notify users, roles or everyone. The module stores message text to deliver it; cancellation clears pending text, and maintenance deletes events and their job receipts thirty days after their delivery window. Limits are ten pending events per requester, one hundred active events and one thousand retained events per server. The shared server job limit also applies.

An event and its durable job are reserved atomically under the server lock. Worker recreation reads the stored schedule. Delivery stores the Discord message ID; a held job with a receipt can read it back and verify bot authorship. A lost or failed send without a confirmed receipt remains held for investigation. Do not recreate an uncertain event until its destination has been checked. The dashboard separates schedule state from job delivery state and omits stored message text from its history response. Managers see announcements and their own reminders.

## Evidence and remaining scope

PostgreSQL tests cover duplicate reservation, concurrent delivery, service recreation with receipt readback, cancellation, permission loss, disabled modules, mention restrictions, uncertain sends, retention and invalid local times. These checks do not prove an actual bot process restart or natural Discord command execution. Fresh schema qualification applies all fifteen migrations and creates sixty-four domain tables in a disposable database.

E05 now includes one-time schedules, recurring announcements, native polls, suggestions, AFK state and opt-in birthdays. Natural Discord scheduling, restart and delivery readback remain qualification gates.

## Recurring announcements

Managers use `/announce series` in the destination channel, supplying the first local date/time, IANA zone, `daily` or `weekly` cadence, explicit `earlier` or `later` ambiguity choice, and `days` from 1 through 365 (default 30). The first event is reserved immediately; maintenance reserves each later occurrence after the previous job has a confirmed delivery receipt. Daily and weekly intervals follow the local calendar, preserving the chosen wall time across offset changes. A nonexistent local time is skipped. The series ends at the start instant plus the selected number of 24-hour days, including an occurrence exactly at that boundary.

`/announce series-list` lists the latest ten series. `/announce series-cancel id:…` cancels the series and clears all pending occurrence text under the server lock. An occurrence already sent cannot be withdrawn by cancellation. The dashboard lists up to one hundred series without message text. Limits are ten active series per creator and one hundred retained series per server, in addition to the shared schedule and job limits.

The stored next time and occurrence ID survive worker recreation. Concurrent maintenance passes share the server lock and an occurrence request key. Occurrences older than their one-day delivery window are skipped, avoiding backlog replay. A prior failed, cancelled or uncertain job holds future occurrences for inspection. Disabled modules cannot reserve or send messages. Batches rotate through due series so one unavailable server cannot occupy every pass. Cancelled/completed series are removed thirty days after their end time; held series retain their bounded investigation record.

Six additional PostgreSQL checks cover concurrent creation, concurrent/restarted scheduler passes, uncertainty holds, cancellation, disabled modules and missed-occurrence skipping. Three calendar checks cover daily/weekly missing times and both repeated-time choices. Fresh database qualification applied eighteen migrations and created sixty-nine domain tables; all fifteen schedule/series database checks passed. Two dashboard checks cover held status and unavailable reads. This is local qualification; hosted CI, actual Discord commands and natural recurring delivery are separate evidence.
