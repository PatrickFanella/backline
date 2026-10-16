# Full-feature release qualification

This candidate implements the feature scope in [the expansion roadmap](./bot-expansion-roadmap.md). Public qualification remains a separate gate. Use [DEPLOYMENT.md](../../DEPLOYMENT.md) for the release package, backup, upgrade and rollback procedure.

## Implemented scope

| Capability                           | Available surfaces and checks                                                                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation and server administration | Guild installation and OAuth authorization, server selector, module settings, durable jobs, setup/status/help commands, privacy and retention controls                                 |
| Community management                 | Moderation and audit, onboarding, self roles with components or reactions, anti-spam, tickets and transcripts                                                                          |
| Engagement and utilities             | Giveaways, XP and voice eligibility, activity reports, custom templates, reminders, polls, suggestions, AFK, birthdays, recurring announcements                                        |
| Integrations and workflows           | Twitch, YouTube and RSS adapters; destination settings, deduplication, retries, bounded trigger/condition/action workflows and delivery history                                        |
| Recovery                             | Retained structure snapshots and templates, named resource selection, preview and ID mapping, current-owner confirmation, bounded selective apply and step receipts                    |
| Economy and entertainment            | Fictional balances and ledger, daily rewards, inventory and games, approved image templates, collections and atomic trades                                                             |
| Audio                                | Approved radio sources, per-server queues and playlists, votes and DJ controls, volume/shuffle/loop, idle cleanup, approved WAV clips and soundboards, quotas and DAVE-capable runtime |

Modules remain opt-in per server. Configuration availability does not establish provider delivery, voice playback, or public-install qualification. Server recovery does not reconstruct original message authors, IDs, deleted accounts or Discord-managed roles.

## Candidate evidence

Local qualification covers the complete backend test suite and coverage gate, every PostgreSQL integration suite on a disposable database with all migrations, frontend tests, type checks, lint, production builds and documentation build. Migration qualification covers both fresh installation with permission seed and adoption of the legacy schema with a retained fixture. Record counts and the exact commit in the release receipt; do not substitute a test result from an older commit.

The isolated release package has exercised the migration barrier, non-root API startup, dashboard/API proxy, Socket.IO handshake, permission seed, graceful API shutdown, fixture persistence, database backup and restoration with table-data and sequence comparison, application rollback against the expanded schema, and return to the candidate images. This environment uses fixture credentials and does not open a second live bot Gateway session.

Canonical Gitea CI must qualify the exact proposed head. A labeler check or a successful local build is insufficient. Image qualification builds locally without publishing to an external registry. Coverage and build artifacts stay with Gitea CI.

Session recovery must complete after reloading a selected server. The browser retains the server ID and checks it against the current account's authorized server list. Session reads, refresh requests and cross-tab refresh-lock acquisition have ten-second deadlines; connection failures offer a retry. The API trusts forwarded client addresses only from a loopback proxy. That proxy must overwrite client-supplied forwarding headers at the trusted ingress. Global API admission allows 300 requests per minute per client; progressive slowdown begins after 120 requests per minute and is capped at one second. Authentication and action-specific limits remain separate. Test a normal module-dashboard burst as well as cold-session recovery before release.

Host-pressure admission preserves session/OAuth recovery, sign-out, public status reads, the authorized server list, module-list reads and basic module configuration saves. These requests still pass their existing authentication, server authorization, validation and rate limits. Analytics, execution actions, uploads and other requests remain subject to load shedding; dependency failures can still open the application circuit. Qualify session recovery and configuration with simulated CPU and memory pressure, including unauthorized requests, rather than relying on health probes alone.

The backend pins Prisma CLI and client to 6.19.3 and overrides only `@prisma/config`'s `deepmerge-ts` to 8.0.2 to address its prototype-pollution advisory. This repository uses the standard schema and client generator; it does not rely on the changed Map-merging behavior. Client generation, fresh migration and permission seed, and legacy-schema adoption are checked with that override. Prisma CLI is a production dependency because the migration service uses it. The backend image removes development dependencies after compilation; the dashboard image contains static output. Production dependency audits do not establish that build and test dependencies are free of advisories.

## Live gates before a full-feature public launch

1. Complete owner OAuth login, callback, server selection and reload in the owner's browser. Verify access revocation there as well as at the API boundary.
2. Have an independent community administrator install, configure, remove and reinstall the bot without operator database edits or an operator-maintained guild allowlist.
3. Exercise the advertised Discord actions in the pilot, including missing permissions, restart recovery, and selective structure recovery in a disposable server.
4. Observe one real event from each advertised provider reaching its authorized destination. An empty channel poll, credentials check or mocked event does not prove natural delivery. The owner selected `https://geesemag.com/feed.xml` for the RSS pilot. Its first successful poll establishes a baseline without posting historical articles.
5. Play approved audio in real voice sessions in two servers, hear the output, interrupt it, and verify reconnect and independent queues on the intended host.
6. Complete the roadmap's observation period and record operational errors and feedback. Preserve the release image, configuration, migration and recovery receipts.

These gates require live accounts, participant actions or elapsed observation. Until they pass, describe the release as a candidate and keep public access gated. Any reduced launch scope needs an explicit decision about which unqualified modules are excluded.
