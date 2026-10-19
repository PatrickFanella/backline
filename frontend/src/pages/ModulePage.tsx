import { Link, useParams } from 'react-router-dom';

import ModuleSettings from '../components/ModuleSettings';
import ModuleToggle from '../components/ModuleToggle';
import ServerSwitcher from '../components/ServerSwitcher';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { Page, PageHeader } from '../components/ui/Page';
import { useModules } from '../hooks/useModules';
import { useServers } from '../hooks/useServers';
import {
    hasModuleSettings,
    moduleCategories,
    moduleCategory,
    moduleName,
    modulePath,
    moduleState,
    type ModuleState,
} from '../lib/modules';
import { useGuild } from '../store/guild';

const stateBadge: Record<
    ModuleState,
    { tone: 'success' | 'neutral' | 'warning'; label: string }
> = {
    enabled: { tone: 'success', label: 'Enabled' },
    disabled: { tone: 'neutral', label: 'Off' },
    blocked: { tone: 'warning', label: 'Needs operator' },
};

/** Pages elsewhere in the dashboard that belong to a module. */
const relatedPages: Record<string, { to: string; label: string }[]> = {
    moderation: [{ to: '/moderation', label: 'Moderation cases' }],
    activity: [{ to: '/observed-activity', label: 'Observed activity' }],
};

/** Discord permission bits the module registry declares, by decimal value. */
const permissionNames: Record<string, string> = {
    '2': 'Kick Members',
    '4': 'Ban Members',
    '16': 'Manage Channels',
    '64': 'Add Reactions',
    '1024': 'View Channel',
    '2048': 'Send Messages',
    '8192': 'Manage Messages',
    '16384': 'Embed Links',
    '65536': 'Read Message History',
    '1048576': 'Connect',
    '2097152': 'Speak',
    '268435456': 'Manage Roles',
    '1099511627776': 'Moderate Members',
    '562949953421312': 'Send Polls',
};

function permissionLabel(value: string) {
    return permissionNames[value] ?? `Permission ${value}`;
}

export default function ModulePage() {
    const { moduleId = '' } = useParams();
    const {
        servers,
        loading: serversLoading,
        error: serversError,
    } = useServers('sync');
    const guildId = useGuild((state) => state.guildId);
    const {
        modules,
        loading,
        loaded,
        busy,
        setBusy,
        error,
        notice,
        reload,
        toggle,
    } = useModules(guildId);
    const module = modules.find((item) => item.id === moduleId);
    const category = moduleCategories.find(
        (item) => item.id === moduleCategory(moduleId)
    );
    const siblings = modules.filter(
        (item) => moduleCategory(item.id) === moduleCategory(moduleId)
    );
    const state = module
        ? moduleState(module.settings, module.operatorReady)
        : null;
    const combinedError = error || serversError;
    const related = relatedPages[moduleId] ?? [];
    return (
        <Page>
            <nav aria-label="Breadcrumb" className="bl-breadcrumb">
                <ol>
                    <li>
                        <Link to="/servers">Server setup</Link>
                    </li>
                    <li aria-current="page">{moduleName(moduleId)}</li>
                </ol>
            </nav>
            <PageHeader
                eyebrow={`Server setup · ${category?.title ?? 'Module'}`}
                title={moduleName(moduleId)}
                description={module?.description}
                actions={
                    module && state ? (
                        <>
                            <Badge tone={stateBadge[state].tone}>
                                {stateBadge[state].label}
                            </Badge>
                            <ModuleToggle
                                module={module}
                                busy={busy}
                                onToggle={(item) => {
                                    void toggle(item);
                                }}
                            />
                        </>
                    ) : undefined
                }
            />
            {combinedError && (
                <Alert tone="danger" role="alert">
                    {combinedError}
                </Alert>
            )}
            {notice && <Alert tone="success">{notice}</Alert>}
            {serversLoading && <p role="status">Loading server settings…</p>}
            {!serversLoading && !servers.length && !serversError && (
                <EmptyState title="No manageable servers found">
                    <p>
                        The bot must be installed, and your Discord account must
                        have Manage Server permission. Use /setup inside your
                        server to check its installation.
                    </p>
                </EmptyState>
            )}
            <ServerSwitcher servers={servers} disabled={busy !== null} />
            {guildId && loading && (
                <p role="status" className="text-bl-muted">
                    Loading module…
                </p>
            )}
            {guildId && loaded && !module && (
                <EmptyState
                    title="Module not found"
                    actions={
                        <Link
                            to="/servers"
                            className="bl-button bl-button-secondary bl-button-sm"
                        >
                            All modules
                        </Link>
                    }
                >
                    <p>This server does not offer a module with this name.</p>
                </EmptyState>
            )}
            {guildId && module && (
                <div className="bl-module-layout">
                    <section
                        aria-labelledby="module-settings-heading"
                        className="space-y-4 min-w-0"
                    >
                        <h2
                            id="module-settings-heading"
                            className="bl-section-title"
                        >
                            Settings
                        </h2>
                        {state === 'blocked' && (
                            <Alert
                                tone="warning"
                                title="Waiting on the operator"
                            >
                                This module needs the operator to enable its
                                Discord intents and restart the bot. You can
                                prepare its settings now.
                            </Alert>
                        )}
                        {hasModuleSettings(module.id) ? (
                            <div className="bl-settings">
                                <ModuleSettings
                                    key={`${guildId}:${module.id}`}
                                    guildId={guildId}
                                    module={module}
                                    onSaved={reload}
                                    onBusy={(value) =>
                                        setBusy(value ? module.id : null)
                                    }
                                />
                            </div>
                        ) : (
                            <EmptyState as="h3" title="No dashboard settings">
                                <p>
                                    This module is controlled by its enable
                                    switch. Use its commands in Discord once it
                                    is on.
                                </p>
                            </EmptyState>
                        )}
                    </section>
                    <aside className="space-y-4" aria-label="Module details">
                        <div className="bl-card p-4 space-y-3">
                            <h2 className="bl-eyebrow-app">Bot permissions</h2>
                            {module.permissions.length ? (
                                <ul className="flex flex-wrap gap-2">
                                    {module.permissions.map((permission) => (
                                        <li key={permission}>
                                            <Badge>
                                                {permissionLabel(permission)}
                                            </Badge>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-bl-muted">
                                    No extra permissions.
                                </p>
                            )}
                            <p className="text-sm text-bl-muted">
                                Run /setup in Discord to check them.
                            </p>
                        </div>
                        {related.length > 0 && (
                            <div className="bl-card p-4 space-y-2">
                                <h2 className="bl-eyebrow-app">Related</h2>
                                <ul className="space-y-1">
                                    {related.map((item) => (
                                        <li key={item.to}>
                                            <Link
                                                to={item.to}
                                                className="text-bl-accent"
                                            >
                                                {item.label}
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {siblings.length > 1 && (
                            <nav
                                className="bl-card p-4 space-y-2"
                                aria-label={`${category?.title ?? 'Other'} modules`}
                            >
                                <h2 className="bl-eyebrow-app">
                                    {category?.title ?? 'Other modules'}
                                </h2>
                                <ul className="bl-module-nav">
                                    {siblings.map((item) => {
                                        const itemState = moduleState(
                                            item.settings,
                                            item.operatorReady
                                        );
                                        return (
                                            <li key={item.id}>
                                                <Link
                                                    to={modulePath(item.id)}
                                                    aria-current={
                                                        item.id === module.id
                                                            ? 'page'
                                                            : undefined
                                                    }
                                                >
                                                    <span>
                                                        {moduleName(item.id)}
                                                    </span>
                                                    <span
                                                        className="bl-state-dot"
                                                        data-state={itemState}
                                                        title={
                                                            stateBadge[
                                                                itemState
                                                            ].label
                                                        }
                                                    />
                                                    <span className="sr-only">
                                                        {
                                                            stateBadge[
                                                                itemState
                                                            ].label
                                                        }
                                                    </span>
                                                </Link>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </nav>
                        )}
                    </aside>
                </div>
            )}
        </Page>
    );
}
