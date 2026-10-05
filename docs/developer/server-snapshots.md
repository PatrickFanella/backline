# Server structure snapshots

The opt-in `recovery` module adds `/snapshot create|list|export`. Managers can capture a manual snapshot or choose `template:true` to retain it as a reusable source for a later selective restore. The dashboard configures scheduled captures and retention, lists manifests and downloads an authenticated export. Downloads remain server-scoped and verify the stored checksum.

Version 1 includes server name/ID, capture timestamp, role IDs/names/colors/permission bits/positions/managed status, channel IDs/names/types/parents/positions/basic text and voice settings, and permission overwrites. Metadata for unsupported channel types is retained without promising complete reconstruction. It excludes messages, original authors, member accounts, role membership, attachments, emoji, stickers, invites and webhook secrets. See [Discord guild resources](https://docs.discord.com/developers/resources/guild) for the platform’s separate role/channel operations.

A snapshot is a read of roles and channels followed by a locked database reservation. It does not modify Discord. The read is not an atomic Discord transaction; an administrator changing structure during capture can yield metadata from adjacent instants. Duplicate request IDs preserve the first captured manifest. A SHA-256 checksum covers the validated canonical JSON manifest. Corrupt manifests are rejected on export. Exports contain potentially private names and permission assignments and should stay within the server’s authorized operators.

Scheduled capture is explicit, default off, with a 24–168-hour interval and 7–90-day retention (defaults 24 hours and 30 days). The scheduler reserves the current UTC interval only, avoiding missed-interval replay. Durable read-only jobs can retry after an uncertain lease; a stored request-key receipt survives worker recreation. Disabling scheduled capture or the module prevents new captures. Manual capture and export recheck current Manage Server and application-account eligibility.

Each server retains up to ten snapshots, including up to five templates. New capture replaces the oldest non-template when full; templates are protected from that rotation but still expire. Manifest size is limited to one MB, five hundred roles, five hundred channels and five thousand total overwrites. Expired snapshots are removed, and terminal capture job receipts expire after thirty days. Templates do not authorize any restore action; selective restore is a separate preview/application workflow.

## Qualification

Six PostgreSQL checks pass on a fresh database with twenty-one migrations and seventy-three domain tables. They cover duplicate capture, role/channel/overwrite export, checksums, cross-server isolation, current authority, disabled modules, snapshot/template limits, scheduled deduplication, actual worker capture/recreated receipt readback and expiry. Two dashboard checks cover saving a schedule without enabling and failed history reads. Both app builds and changed-file lint pass.

This proves local code behavior. Actual Discord capture/export, natural scheduled capture and restore comparison in a disposable server remain qualification gates. A structure export does not prove application/database backup recovery or Discord server reconstruction.
