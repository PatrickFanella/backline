# Community bot expansion roadmap

Status: proposed implementation sequence. Reviewed October 4, 2026 against source revision `efd93af`. This document records planned behavior; it does not claim that the new modules are implemented or qualified.

Implementation tracking: [Gitea roadmap issue #3](https://git.subcult.tv/subculture-collective/discord-spywatcher/issues/3) contains the full plan and links to the implementation issues, milestones, and dependency graph. Use the tracker for current completion status; the stable IDs below identify the same implementation units.

## Product direction

Build a configurable Discord community bot that other communities can install. Start with SUBCULT as the pilot, then qualify installation and operation in a second independent server before opening public access. Preserve the existing analytics work while adding server management, onboarding, engagement, support, automation, and audio modules.

Each server chooses which modules to enable, where they operate, and which roles can configure them. Use Discord slash commands, buttons, select menus, and modals alongside the existing web dashboard. A server should be able to complete basic setup inside Discord; the dashboard provides deeper configuration and reports.

Keep the Spywatcher repository and name during implementation. Public naming, visual identity, pricing, and hosting commitments remain product decisions. Existing subscription and quota types do not establish a working billing product.

## Reference coverage

The [Codeless bot list](https://codeless.co/discord-bots/) supplies the feature categories below. These comparisons describe the article's examples, not verified feature parity with the current products. Its Hydra music description differs from [Hydra's current site](https://hydra.bot/), which advertises leveling, welcome messages, roles, and message building. Do not base provider integrations or prices on that article alone.

| Article examples                          | Capability to build                                                                                                                   | Delivery stage                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| MEE6, Dyno, ProBot, Arcane                | Moderation cases, warnings, timeouts, kicks, bans, message cleanup, anti-spam, raid controls, member and role logs                    | Core pilot                                                 |
| MEE6, ProBot, Zira, Hydra                 | Welcome and departure messages, join roles, rules acknowledgment, self-service roles through buttons/selects/reactions, embeds        | Core pilot                                                 |
| Arcane, MEE6, Statbot                     | Message and voice XP, levels, leaderboards, role rewards, activity reports, channel counters                                          | Engagement                                                 |
| Helper.gg                                 | Ticket panels, private channels or threads, staff claim/assignment, transcripts, closure and retention                                | Support                                                    |
| Giveaway Bot                              | Persistent giveaways, eligibility rules, entry/withdrawal, scheduled draws and rerolls                                                | Engagement                                                 |
| MEE6, Dyno, Autocode                      | Custom commands, scheduled messages, reminders, polls, suggestions, AFK, birthdays, visual automation rules and external integrations | Automation                                                 |
| MEE6, Arcane                              | Twitch/YouTube notifications, RSS and other provider feeds with deduplication and retries                                             | Automation                                                 |
| Xenon                                     | Server structure snapshots, role/channel templates, scheduled capture, restore preview and guarded application                        | Recovery                                                   |
| Dank Memer                                | Opt-in virtual currency, inventories, daily rewards, small games, curated memes and image templates                                   | Entertainment                                              |
| Mudae                                     | Optional collection game: catalog, rolls, claims, inventory and trading using approved assets                                         | Entertainment extension                                    |
| Octave, Hydra as described in the article | Voice playback, queues, playlists, skip votes, shuffle/loop, volume and reconnect handling                                            | Audio                                                      |
| Voicy                                     | Uploaded or approved sound clips, search, soundboard and playback limits                                                              | Audio                                                      |
| Autocode                                  | Administrator-authored commands and bounded trigger/action workflows                                                                  | Automation; full hosted IDE is outside the initial product |

Voice playback support depends on source APIs and playback rights. A Spotify catalog or playlist integration does not by itself provide streamable audio. Character collections, memes, and clips require their own approved catalog; competitor assets are not a seed dataset. Broader specialist features remain separate extensions after the community bot is qualified.

## What the repository actually contains

This is a source review. Dependencies were not installed and no bot was connected to Discord during the review. File presence and existing tests are implementation evidence, not proof of current runtime behavior.

| Area                     | Source evidence                                                                                                                                                                                          | Implication                                                                                                                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discord event collection | [Bot entrypoint](../../backend/src/index.ts) registers presence, typing, message, join, deletion, and role-update listeners                                                                              | Reuse the collectors, but separate them from startup and module dispatch. There is no slash-command dispatcher in this entrypoint.                                                                                                      |
| Analytics and dashboard  | [Analytics code](../../backend/src/analytics/index.ts), [frontend routes](../../frontend/src/App.tsx)                                                                                                    | Reuse charts, timelines, authentication UI, and API foundations after checking server isolation.                                                                                                                                        |
| Persistence              | [Prisma schema](../../backend/prisma/schema.prisma) uses PostgreSQL; [migration lock](../../backend/prisma/migrations/migration_lock.toml) still names SQLite; the initial migration contains SQLite SQL | Establish a tested PostgreSQL baseline and an explicit existing-data upgrade path before adding feature tables.                                                                                                                         |
| Server-scoped presence   | `PresenceEvent` has no `guildId`; [presence aggregation](../../backend/src/analytics/presence.ts) does not filter by server                                                                              | The original feature needs a migration and scoped queries before use across communities. A server-specific cache key does not isolate the underlying result.                                                                            |
| Server authorization     | [Guild validation](../../backend/src/middleware/validateGuild.ts) checks an environment allowlist; [permission utilities](../../backend/src/utils/permissions.ts) include a separate guild-access helper | An allowlist check cannot establish the caller's current Discord permissions. Trace and enforce access on every server surface.                                                                                                         |
| Multiple administrators  | `Guild.guildId` is unique and each `Guild` row belongs to one `User` in the schema                                                                                                                       | Separate a server installation from user/server membership; support multiple administrators for the same server.                                                                                                                        |
| Live subscriptions       | [WebSocket service](../../backend/src/services/websocket.ts) authenticates a token, then joins requested guild rooms after checking only the ID's shape                                                  | Add server authorization and access revocation to room subscriptions before public onboarding.                                                                                                                                          |
| OAuth                    | [OAuth callback](../../backend/src/routes/auth.ts) logs the client secret and authorization code; state validation is a placeholder                                                                      | Remove sensitive logging and implement one-use, session-bound OAuth state before inviting external administrators. Review deployed exposure separately if this code is running.                                                         |
| Plugins                  | [Plugin manager](../../backend/src/plugins/PluginManager.ts) and [loader](../../backend/src/plugins/PluginLoader.ts) provide lifecycle and hook machinery                                                | The bot entrypoint does not call `executeDiscordHook`. API and bot start as separate processes, so comments about sharing their singleton do not establish a shared runtime. Built-in modules need explicit event wiring and transport. |
| Automation               | [Rules engine](../../backend/src/services/rulesEngine.ts) sends HTTP webhooks; notification, email, and Discord-message actions currently log placeholders and report success                            | Preserve the rule editor, but report actual delivery results and add durable executions before treating it as automation.                                                                                                               |
| Moderation               | [Ban routes](../../backend/src/routes/bans.ts) include application/IP access controls                                                                                                                    | These are separate from Discord member bans and moderation cases. Build the Discord moderation domain explicitly.                                                                                                                       |

## Architecture to extend

Keep TypeScript, discord.js, Express, React, Prisma/PostgreSQL, and Redis. Start with clear modules in the existing repository. Additional Kubernetes or service decomposition is not a prerequisite for a small pilot.

The bot owns the Discord Gateway connection, command handling, and Discord actions. The API owns dashboard requests and configuration. A worker owns durable scheduled work and external polling. PostgreSQL holds authoritative configuration, domain state, job state, and action history. Redis may provide caches, pub/sub, and coordination, but losing a cache must not lose a giveaway or scheduled action.

Proposed boundaries:

```text
backend/src/bot/          client startup, event routing, interaction dispatch
backend/src/modules/      built-in modules with commands, handlers, services
backend/src/guilds/        installations, membership, permissions, configuration
backend/src/jobs/          durable scheduling, retries, delivery reconciliation
backend/src/routes/       authenticated dashboard/API adapters
backend/src/analytics/    existing analytics, migrated to server-scoped access
frontend/src/pages/       server overview, setup, module settings, reports
```

Each module declares its identifier, configuration version/schema, commands, events, required Discord permissions/intents, and enable/disable behavior. Handlers receive an authorized server context. Configuration is per server, versioned, and validated on both command and dashboard paths. Disabling a module prevents new actions and applies a documented policy to its pending jobs.

Keep installation and authorization distinct: installation records describe where the bot is present; membership records describe who can manage each server. Site operators and server administrators have separate authority. Recheck sensitive Discord permissions before performing an action, including after a job has waited in a queue. Compare both the actor's and bot's role hierarchy against the target.

Use a PostgreSQL-backed job store initially, or select a queue with equivalent durable guarantees during foundation work. Record lease ownership, attempts, next-run time, expiry, idempotency keys, and observable failures. Discord and database writes are not one transaction: recover uncertain outcomes without blindly repeating a ban, giveaway draw, or announcement. Use provider IDs and recorded Discord message IDs where possible; document operations whose outcome requires reconciliation.

Existing plugins are trusted operator-installed code, not a sandbox for arbitrary community code. Server-authored commands use validated templates and bounded actions. A future plugin marketplace or arbitrary script execution requires a separate design.

## Ordered implementation backlog

Each row is a bounded implementation unit suitable for a Gitea issue. Dependencies refer to these stable IDs; they are not issue numbers. Every unit includes relevant API/dashboard surfaces and documentation, rather than stopping at a command stub.

### Stage 0: foundation

| ID  | Work and affected boundaries                                                                                                                  | Depends on | Acceptance evidence                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 | Establish install, type-check, lint and focused-test baseline; reconcile PostgreSQL schema/migrations. Packages, Prisma, CI.                  | —          | A fresh isolated PostgreSQL database migrates and seeds; an existing-data fixture upgrades with counts preserved. Record preexisting failures.                                                                      |
| F02 | Server installation, membership, module configuration and scoped presence migration. Prisma, collectors, analytics, auth guild sync.          | F01        | Two administrators manage one server; the same member in two servers produces separate results. Unattributable legacy presence is retained outside server reports, never guessed into a server.                     |
| F03 | Shared server authorization for REST, API keys, WebSockets and jobs; OAuth state and sensitive-log repair. Auth, routes, sockets.             | F02        | A user authorized for server A cannot query, subscribe to, configure, or act on B. OAuth state replay fails; secret/code values are absent from logs. Access loss is enforced.                                      |
| F04 | Extract bot startup and collectors; introduce module registry, event dispatch, slash commands and interaction routing. Bot, modules, plugins. | F03        | Guild-only `/help`, `/setup`, `/settings`, `/status` work in a test server; unknown/stale components fail clearly; disabled modules perform no actions. Interaction acknowledgment and error isolation are checked. |
| F05 | Durable jobs and action records; API-to-bot delivery with correlation and reconciliation. Jobs, bot, API, monitoring.                         | F04        | Restart during a scheduled test action recovers pending work; competing workers cannot both own it; retries expose failures and reconcile uncertain delivery.                                                       |
| F06 | Dashboard server picker, setup flow, module cards and permission diagnostics. Frontend, routes.                                               | F04        | Authorized administrators configure their server in browser and Discord; settings persist and match; missing bot permissions explain the required action.                                                           |

### Stage 1: useful SUBCULT pilot

| ID  | Work and affected boundaries                                                                                                                   | Depends on    | Acceptance evidence                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C01 | Moderation cases and `/warn`, `/timeout`, `/kick`, `/ban`, `/unban`, `/purge`; reasons and case history. Moderation module, Prisma, dashboard. | F05, F06      | Successful actions have recorded Discord outcomes; unauthorized actors and higher-role targets are denied; unavailable permissions do not produce false success.                                                               |
| C02 | Member/message/role audit logging, moderation log channel and retention settings. Logging module, collectors, dashboard.                       | C01           | Configured events reach only the selected server/channel; cache-missing deletions degrade gracefully; content retention follows the server's choice.                                                                           |
| C03 | Welcome/departure messages, embeds, join roles and rules acknowledgment. Onboarding module, message builder.                                   | F05, F06      | A join produces configured output and eligible roles; invalid channels and unassignable roles are diagnosed; duplicate events do not duplicate welcomes.                                                                       |
| C04 | Self-service roles with buttons/selects, optional reactions, exclusive groups and prerequisites. Roles module, dashboard.                      | C03           | Role choices survive restart; users cannot gain privileged or unmanaged roles; exclusivity and prerequisite rules hold.                                                                                                        |
| C05 | Anti-spam, mention flood, prohibited links/words, join bursts and raid mode; native Discord AutoMod where suitable. Moderation module.         | C01, C02      | Fixture bursts trigger expected actions and exemptions; observe-only mode records decisions; SUBCULT tunes thresholds before enabling enforcement.                                                                             |
| C06 | SUBCULT pilot qualification and release receipt. Tests, operations, docs.                                                                      | C02, C04, C05 | Natural join, role selection, moderation and dashboard configuration pass in the pilot. Restart, missing permissions and rollback are exercised; a proposed seven-day observation period records errors and operator feedback. |

The first release stops here. It must be useful without XP, economy, or music enabled.

### Stage 2: support, engagement and automation

| ID  | Work and affected boundaries                                                                                                                 | Depends on | Acceptance evidence                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E01 | Tickets: panels, categories, private channels/threads, claim, add/remove participants, close/reopen, transcripts and expiry. Tickets module. | C06        | A second ticket cannot expose a first ticket's content; only eligible staff/participants have access; close/export/restart behavior preserves state.                                           |
| E02 | Giveaways: buttons, withdrawal, eligibility, scheduled drawing and recorded rerolls. Giveaways module, jobs.                                 | C06        | Concurrent draws persist one winner set; restart at deadline completes the draw; role eligibility is checked at draw time; rerolls retain prior history.                                       |
| E03 | XP/levels, leaderboards, message cooldowns, optional voice XP and role rewards. Leveling module.                                             | C06        | Bots, excluded channels and repeated messages do not farm XP; concurrent updates preserve totals; reward assignment respects hierarchy. Voice excludes configured AFK/deafened states.         |
| E04 | Community activity reports, retention trends and channel counters using scoped collectors. Analytics, dashboard, jobs.                       | C06        | Fixture totals reconcile by server and time range; reports distinguish unavailable history from zero activity; counters update within configured rate limits.                                  |
| E05 | Custom command templates, embeds, reminders, scheduled announcements, polls, suggestions, AFK and birthdays. Utilities module, jobs.         | C06        | Templates cannot run arbitrary code or trigger unapproved mentions; time zones and daylight saving are tested; restart preserves scheduled events.                                             |
| E06 | Twitch/YouTube/RSS adapters, notification destinations, credentials and deduplication. Integrations module.                                  | E05        | One real provider event reaches one pilot destination; outages retry with backoff; reconnect does not replay the whole feed; credentials stay out of output. Qualify each provider separately. |
| E07 | Bounded trigger/condition/action workflows and actual Discord delivery. Rules engine, dashboard, jobs.                                       | E05, E06   | Execution history distinguishes attempted, delivered and failed actions; loops and repeated triggers are bounded; destinations are authorized for the current server.                          |

### Stage 3: recovery and entertainment

| ID  | Work and affected boundaries                                                                                | Depends on | Acceptance evidence                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X01 | Server structure snapshots, scheduled capture and reusable templates. Recovery module, storage.             | C06        | Roles, channels and permission overwrites export with a versioned manifest; retention is bounded; snapshot/restore comparison works in a disposable server.                                             |
| X02 | Restore preview, ID mapping, selective apply and protected resources. Recovery module, jobs.                | X01        | Preview lists creations, updates and deletions before application; stale previews require refresh; partial failure resumes safely. Destructive application requires explicit server-owner confirmation. |
| X03 | Virtual economy, ledger, inventories, daily rewards and small games. Economy module.                        | E03        | Atomic transactions prevent duplicate rewards and negative balances; server economies remain separate; admin adjustments have a traceable ledger. Begin with fictional points.                          |
| X04 | Curated memes, image templates and optional collection/trading game. Entertainment module, catalog/storage. | X03        | Approved assets have provenance; rate limits apply; simultaneous claims/trades cannot duplicate inventory; users can disable unwanted game notifications.                                               |

Structure recovery has a defined scope: it does not promise restoration of original message authors, message IDs, deleted member accounts, or Discord-managed roles. Transcript export and application/database recovery are separate features from Discord server reconstruction.

### Stage 4: audio and public qualification

| ID  | Work and affected boundaries                                                                                                                 | Depends on                            | Acceptance evidence                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 | Voice playback proof using a maintained DAVE-capable library and approved uploaded audio/radio sources. Audio module, dependencies, runtime. | C06                                   | A real Discord voice session plays audio, reconnects and stops cleanly on the intended host. Record library/runtime versions and source behavior.                                            |
| A02 | Per-server queues, playlists, skip votes, shuffle/loop, volume, DJ permissions and idle cleanup. Audio module, storage.                      | A01                                   | Two servers play independently; permission and vote rules hold; malformed sources and network interruption do not crash the bot.                                                             |
| A03 | Sound clip upload/search, soundboards, quotas and retention. Audio module, dashboard/storage.                                                | A02                                   | Upload validation and storage limits hold; clips have approved provenance; playback is bounded and can be interrupted by authorized members.                                                 |
| P01 | Independent community installation and uninstallation. Onboarding, auth, docs.                                                               | C06, F03                              | A second server's administrator installs without operator database edits or editing `BOT_GUILD_IDS`; setup, permission loss, bot removal and reinstall behave correctly.                     |
| P02 | Public release qualification, support and operations. CI, deployment, policies, docs.                                                        | P01; all modules advertised at launch | Gitea CI, browser flows, real Discord actions, backup restore, restart recovery and rollback pass for the release revision. Disabled or unqualified modules are excluded from launch claims. |

Audio and entertainment can run as separate work streams after their prerequisites pass. Neither blocks public release if excluded from the advertised release scope. Full roadmap coverage requires qualifying them before advertising them.

## Data, migration and recovery requirements

Retain existing histories. For the presence migration, add a nullable server ID first, write it for all new events, and scope all server queries to attributed records. Historical rows without reliable attribution stay in a restricted legacy dataset until a separately reviewed retention decision. Add appropriate server/time indexes. Do not infer attribution merely because a member belongs to a server.

Create a server installation table and a user/server membership table with a compound uniqueness constraint. Migrate the current single-user `Guild` association without dropping administrator access. New settings, cases, tickets, jobs, rewards, balances, feeds and snapshots must carry a server ID. Review existing account-level and site-level data deliberately rather than adding a server column indiscriminately.

Use additive migrations where possible. Before an existing-data upgrade, capture a recoverable database backup and prove restoration against an isolated copy. A code rollback must remain compatible with the expanded schema. Gate incompatible cleanup until the older version is retired. Record revisions, migration versions, pilot configuration, and recovery steps with each release.

## Discord constraints that shape implementation

Discord treats member, presence, and message-content intents as privileged. Enable only the intents the selected capabilities need, and use the current Developer Portal review requirements when expanding public installation. Make missing intent access visible in setup. Core slash commands, role components, tickets and giveaways should remain usable when presence analytics or content inspection is unavailable. See [Discord Gateway documentation](https://docs.discord.com/developers/events/gateway#privileged-intents).

Voice work requires current end-to-end encryption support: Discord's [voice documentation](https://docs.discord.com/developers/topics/voice-connections#end-to-end-encryption-dave-protocol) specifies DAVE support for calls from March 1, 2026. An old music-bot tutorial is not sufficient implementation evidence.

Reframe the original presence feature as optional observed activity. Multi-client use, silence, and fast typing do not establish misconduct. Preserve existing analysis, but do not automatically punish users based on suspicion scores. Provide server-visible collection settings, channel exclusions, content retention controls and access restrictions. Prefer aggregate activity reports as the default public analytics surface.

## Verification and release gates

Establish these local gates in F01 using locked dependencies and an isolated test database:

```bash
rtk npm run type-check
rtk npm run lint
rtk npm test --prefix backend -- --runInBand
rtk npm test --prefix frontend
rtk npm run build --prefix backend
rtk npm run build --prefix frontend
rtk npm run docs:build
```

Use targeted checks during each unit, then run the relevant broader gates when shared contracts change. Add meaningful tests for cross-server access denial, role hierarchy, migration preservation, concurrent writes, restart recovery and delivery failures. The frontend test script already invokes `vitest run`. Do not turn baseline failures into passing results by silently dropping tests.

A module moves through proposed, implemented, locally tested, pilot verified, and public qualified states. Keep the evidence distinct: mocks establish local behavior; Gitea CI establishes checks for a hosted revision; browser checks establish dashboard flows; real Discord/provider events establish delivery; natural pilot observation establishes sustained operation. Health endpoints alone do not qualify a feature.

Public launch requires independent-server onboarding, per-server authorization, permission revocation, privacy/retention controls, bounded storage and jobs, actionable monitoring, operator recovery procedures and a tested rollback. Inspect current Gitea CI before changing workflows; the checkout contains GitHub workflow files, which do not establish current canonical hosted CI. Keep public access gated until P02 passes.

## First implementation slice

Start with F01–F04: establish a reproducible database/check baseline, repair server isolation and OAuth handling, then deliver the module framework and `/help`, `/setup`, `/settings`, `/status`. Follow with durable actions and dashboard setup before implementing Discord moderation. This leaves a usable foundation that every subsequent module can share.

This planning change adds no runtime features. Its validation covers document links and the patch; compilation, bot execution, provider delivery, deployment, and pilot qualification remain work for the implementation units.
