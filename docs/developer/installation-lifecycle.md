# Independent installation lifecycle

Invite application `1375864689577164911` with the `bot` and `applications.commands` scopes. The installing Discord account needs Manage Server or server ownership. Leave `BOT_GUILD_IDS` empty to support independent installations; a populated value remains an optional operator restriction.

A newly discovered installation now provisions the bot's commands automatically. A normal restart preserves known command deployments unless `BOT_REGISTER_COMMANDS=true`. Live guild-create events record the installation and provision commands. Registration upserts only the bot's known command names and preserves unrelated commands.

Uninstalling deactivates the installation, disables its modules and cancels pending jobs while keeping saved settings and history. Actions already leased become reconciliation holds with an uncertain attempt record. Reinstallation activates the server but leaves modules disabled until a manager opts back in. Missing installations found on startup follow the same removal path.

`/setup` reports module intents and action-specific bot permission gaps. Observation and history can remain enabled without mutation permissions; every action still checks its own current Discord permissions and target/channel constraints. A zero-permission invite is enough to install the bot and use core commands; grant the required role and channel permissions for the modules you choose.

On October 4, 2026, Discord confirmed application installation in servers `947948179897327686` and `1450935212170285237`. The second installation registered and read back twelve commands with the operator allowlist unset and no operator database edits. Human second-administrator configuration, uninstall/reinstall in Discord, and OAuth browser consent remain qualification gates. Database lifecycle tests cover cancellation, settings preservation and in-flight uncertainty; provisioning tests cover new installations and ordinary restart.
