# Native Discord polls

The opt-in `polls` module adds `/poll create`, `/poll close` and `/poll results`. Managers create polls in their current server text channel using a question and two to ten distinct answers separated by `|`. Questions are limited to 300 characters and answers to 55. The `hours` option accepts 1 to 768 hours; `multiple` permits several selections. Announcement channels and threads are outside this implementation.

Creation and early closure require current Manage Server permission. The bot requires View Channel, Send Messages, Send Polls and Read Message History in that channel. Members reading results must retain View Channel and Read Message History. Application-banned accounts cannot use the module. Every send rechecks the installation, module and permissions.

Creation and closure use durable jobs. Each server retains at most one thousand poll actions, subject to the shared active-job cap. Maintenance removes completed, failed and cancelled receipts and their attempts after thirty-two days; uncertain sends remain held within that cap. A competing worker leases one action. A lost send remains held for investigation and is never automatically repeated. Creation without a stored receipt cannot prove whether a poll exists: check the destination before recreating it. Closure reconciliation reads the original message and holds the action if the poll is still open. Only Backline-authored polls can be closed or read with these commands.

Discord owns voting, poll expiry and tallying. Backline reads aggregate counts, distinguishes unavailable results from zero votes, and labels an unfinalized tally as current. It does not collect voter identities. Message sends disable notification mentions. Discord polls cannot be edited after creation. See the [Discord poll reference](https://docs.discord.com/developers/resources/poll).

## Qualification

PostgreSQL tests cover duplicate reservation, competing workers, uncertain sends, manager and bot permissions, module disablement and poll closure ownership. Builds and mocks do not establish actual Discord voting, tally finalization or early closure. Those natural checks remain required before public advertising. Suggestions, AFK, birthdays and recurring announcements remain unfinished E05 work.
