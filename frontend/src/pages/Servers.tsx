import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { ModuleRecord } from '../components/ModuleSettings';
import ModuleToggle from '../components/ModuleToggle';
import ServerSwitcher from '../components/ServerSwitcher';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { Input } from '../components/ui/Field';
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

type Filter = 'all' | ModuleState;

const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'enabled', label: 'Enabled' },
    { id: 'disabled', label: 'Disabled' },
    { id: 'blocked', label: 'Needs operator' },
];

const stateBadge: Record<
    ModuleState,
    { tone: 'success' | 'neutral' | 'warning'; label: string }
> = {
    enabled: { tone: 'success', label: 'Enabled' },
    disabled: { tone: 'neutral', label: 'Off' },
    blocked: { tone: 'warning', label: 'Needs operator' },
};

function ModuleCard({
    module,
    busy,
    onToggle,
}: {
    module: ModuleRecord;
    busy: string | null;
    onToggle: (module: ModuleRecord) => void;
}) {
    const state = moduleState(module.settings, module.operatorReady);
    const badge = stateBadge[state];
    const headingId = `module-${module.id}`;
    return (
        <article
            className="bl-module-card"
            data-state={state}
            aria-labelledby={headingId}
        >
            <div className="bl-module-card-head">
                <h4 id={headingId}>{moduleName(module.id)}</h4>
                <Badge tone={badge.tone}>{badge.label}</Badge>
            </div>
            <p className="bl-module-card-desc">{module.description}</p>
            {state === 'blocked' && (
                <p className="text-sm text-bl-warning">
                    This module needs the operator to enable its Discord intents
                    and restart the bot.
                </p>
            )}
            <div className="bl-module-card-foot">
                <Link
                    to={modulePath(module.id)}
                    className="bl-button bl-button-secondary bl-button-sm"
                    aria-label={`${hasModuleSettings(module.id) ? 'Configure' : 'View'} ${moduleName(module.id)}`}
                >
                    {hasModuleSettings(module.id) ? 'Configure' : 'Details'}
                </Link>
                <ModuleToggle module={module} busy={busy} onToggle={onToggle} />
            </div>
        </article>
    );
}

export default function Servers() {
    const {
        servers,
        loading: serversLoading,
        error: serversError,
    } = useServers('sync');
    const guildId = useGuild((state) => state.guildId);
    const { modules, loading, busy, error, notice, toggle } =
        useModules(guildId);
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<Filter>('all');
    const enabledCount = modules.filter(
        (module) => module.settings.enabled
    ).length;
    const blockedCount = modules.filter(
        (module) => !module.operatorReady && !module.settings.enabled
    ).length;
    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return modules.filter((module) => {
            const state = moduleState(module.settings, module.operatorReady);
            if (filter !== 'all' && state !== filter) return false;
            if (!needle) return true;
            return (
                moduleName(module.id).toLowerCase().includes(needle) ||
                module.id.includes(needle) ||
                module.description.toLowerCase().includes(needle)
            );
        });
    }, [modules, query, filter]);
    const combinedError = error || serversError;
    return (
        <Page>
            <PageHeader
                eyebrow="Backline · Server setup"
                title="Set up your server"
                description="Enable the modules your community needs, then open a module to configure it. Modules start disabled, settings are shared with /settings in Discord, and /setup checks the bot’s permissions."
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
            {guildId && (
                <section aria-labelledby="module-heading" className="space-y-6">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                        <div>
                            <h2
                                id="module-heading"
                                className="bl-section-title"
                            >
                                Server modules
                            </h2>
                            <p
                                className="text-bl-muted mt-1"
                                aria-live="polite"
                            >
                                {loading
                                    ? 'Loading modules…'
                                    : `${enabledCount} of ${modules.length} modules enabled` +
                                      (blockedCount
                                          ? `, ${blockedCount} waiting on the operator`
                                          : '')}
                            </p>
                        </div>
                        <div className="flex flex-wrap items-end gap-3">
                            <Input
                                label="Find a module"
                                type="search"
                                compact
                                value={query}
                                onChange={(event) =>
                                    setQuery(event.target.value)
                                }
                                placeholder="Name or keyword"
                            />
                            <div
                                role="group"
                                aria-label="Filter modules by state"
                                className="flex flex-wrap gap-2 pb-0.5"
                            >
                                {filters.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className="bl-chip"
                                        aria-pressed={filter === item.id}
                                        onClick={() => setFilter(item.id)}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                    {!loading && modules.length > 0 && visible.length === 0 && (
                        <EmptyState as="h3" title="No modules match">
                            <p>
                                Clear the search or choose a different filter.
                            </p>
                        </EmptyState>
                    )}
                    {moduleCategories.map((category) => {
                        const items = visible.filter(
                            (module) =>
                                moduleCategory(module.id) === category.id
                        );
                        if (!items.length) return null;
                        return (
                            <section
                                key={category.id}
                                aria-labelledby={`category-${category.id}`}
                                className="space-y-3"
                            >
                                <div>
                                    <h3
                                        id={`category-${category.id}`}
                                        className="bl-eyebrow-app"
                                    >
                                        {category.title}
                                    </h3>
                                    <p className="text-sm text-bl-muted mt-1">
                                        {category.description}
                                    </p>
                                </div>
                                <div className="bl-module-grid">
                                    {items.map((module) => (
                                        <ModuleCard
                                            key={`${guildId}:${module.id}`}
                                            module={module}
                                            busy={busy}
                                            onToggle={(item) => {
                                                void toggle(item);
                                            }}
                                        />
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </section>
            )}
            <footer className="flex flex-wrap gap-5 text-bl-accent text-sm">
                {guildId && <Link to="/moderation">Moderation cases</Link>}
                {guildId && (
                    <Link to="/observed-activity">
                        Observed activity reports
                    </Link>
                )}
                <Link to="/status">Service status</Link>
            </footer>
        </Page>
    );
}
