# Scheduled channel utilities

The opt-in `scheduled-utilities` module adds `/remind create|list|cancel` and `/announce create|list|cancel`. Create the event in its destination text or announcement channel. Reminders require the requester to retain channel access and permission to send messages. Announcements require current Manage Server permission. Backline rechecks membership, application-account status, module installation and channel permissions at delivery.

The `time` argument is `YYYY-MM-DDTHH:mm`; `timezone` is an IANA zone. Nonexistent daylight-saving times are rejected. Repeated times require an explicit `ambiguity:earlier` or `ambiguity:later`. One-time events must be at least ten seconds in the future and no more than thirty days away. Delivery has a one-day expiry window. This version has no recurring schedule or cross-post action.

Reminders mention only their requester. Announcement content cannot notify users, roles or everyone. The module stores message text to deliver it; cancellation clears pending text, and maintenance deletes events and their job receipts thirty days after their delivery window. Limits are ten pending events per requester, one hundred active events and one thousand retained events per server. The shared server job limit also applies.

An event and its durable job are reserved atomically under the server lock. Worker recreation reads the stored schedule. Delivery stores the Discord message ID; a held job with a receipt can read it back and verify bot authorship. A lost or failed send without a confirmed receipt remains held for investigation. Do not recreate an uncertain event until its destination has been checked. The dashboard separates schedule state from job delivery state and omits stored message text from its history response. Managers see announcements and their own reminders.

## Evidence and remaining scope

PostgreSQL tests cover duplicate reservation, concurrent delivery, service recreation with receipt readback, cancellation, permission loss, disabled modules, mention restrictions, uncertain sends, retention and invalid local times. These checks do not prove an actual bot process restart or natural Discord command execution. Fresh schema qualification applies all fifteen migrations and creates sixty-four domain tables in a disposable database.

This is the one-time reminder and announcement portion of E05. Recurring schedules, polls, suggestions, AFK state and birthdays remain unfinished. Natural Discord scheduling, restart and delivery readback remain qualification gates.
