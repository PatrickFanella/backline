# Backline backend

The Discord bot and API for Backline. This package includes community management, optional activity analytics, audio, integrations, and the server module framework.

See the [developer guide](../docs/developer/index.md) for setup and the [release qualification notes](../docs/developer/release-qualification.md) for implemented scope and remaining live checks. The canonical repository is [Backline on Gitea](https://git.subcult.tv/subculture-collective/backline).

## Branding and compatibility

API documentation, startup messages, security alerts, plugin examples, and log service labels use Backline. Log service labels are `backline` and `backline-security`; update filters that relied on the old labels.

Some technical names remain for existing installations and clients:

- API keys retain the `spy_live_` prefix.
- Redis cache and pub/sub namespaces retain `spywatcher:` to preserve shared state and communication between processes during upgrades.
- Plugin manifests retain `spywatcherVersion` as the version compatibility field.
- The SDK retains the `@spywatcher/sdk` package and `Spywatcher` class names. Backend documentation uses those actual exports.
- Legacy database names, backup paths, filenames, and encryption recipients remain in environment examples and migration procedures. Use the configured values for the existing installation; this branding change does not migrate storage or encryption keys.

The OpenAPI server URL is `/api`, so documentation targets the host serving it. Standalone request examples use `http://localhost:3001/api`; replace that base URL with the address of your installation.
