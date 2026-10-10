import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import ModuleSettings from '../components/ModuleSettings';
import type { ModuleRecord } from '../components/ModuleSettings';
import ServerSwitcher from '../components/ServerSwitcher';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { Input } from '../components/ui/Field';
import { Page, PageHeader } from '../components/ui/Page';
import { useServers } from '../hooks/useServers';
import api from '../lib/api';
import {
    hasModuleSettings,
    moduleCategories,
    moduleCategory,
    moduleName,
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
    guildId,
    module,
    busy,
    onToggle,
    onSaved,
    onBusy,
}: {
    guildId: string;
    module: ModuleRecord;
    busy: string | null;
    onToggle: (module: ModuleRecord) => void;
    onSaved: (notice?: string) => Promise<void>;
    onBusy: (value: boolean) => void;
}) {
    const state = moduleState(module.settings, module.operatorReady);
    const [open, setOpen] = useState(false);
    const badge = stateBadge[state];
    const settingsId = `module-${module.id}-settings`;
    return (
        <article
            className="bl-module-card"
            data-state={state}
            aria-labelledby={`module-${module.id}`}
        >
            <div className="flex items-start justify-between gap-3">
                <h3 id={`module-${module.id}`}>{moduleName(module.id)}</h3>
                <Badge tone={badge.tone}>{badge.label}</Badge>
            </div>
            <p className="text-bl-muted text-sm">{module.description}</p>
            {state === 'blocked' && (
                <p className="text-sm text-bl-warning">
                    This module needs the operator to enable its Discord intents
                    and restart the bot.
                </p>
            )}
            {hasModuleSettings(module.id) && (
                <details
                    className="bl-details"
                    open={open}
                    onToggle={(event) =>
                        setOpen((event.target as HTMLDetailsElement).open)
                    }
                >
                    <summary aria-controls={settingsId}>
                        Settings and history
                    </summary>
                    <div id={settingsId} className="space-y-4">
                        <ModuleSettings
                            guildId={guildId}
                            module={module}
                            onSaved={onSaved}
                            onBusy={onBusy}
                        />
                    </div>
                </details>
            )}
            <div className="mt-auto pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-bl-border/40">
                <p className="text-xs text-bl-muted">
                    Use /setup in Discord to check the bot’s required
                    permissions.
                </p>
                <button
                    type="button"
                    aria-pressed={module.settings.enabled}
                    disabled={
                        busy !== null ||
                        (!module.operatorReady && !module.settings.enabled)
                    }
                    onClick={() => onToggle(module)}
                    className={
                        module.settings.enabled
                            ? 'bl-button bl-button-secondary bl-button-sm'
                            : 'bl-button bl-button-primary bl-button-sm'
                    }
                >
                    {busy === module.id
                        ? 'Saving…'
                        : module.settings.enabled
                          ? 'Disable'
                          : 'Enable'}
                </button>
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
    const [modules, setModules] = useState<ModuleRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<Filter>('all');
    const guildId = useGuild((state) => state.guildId);
    const generation = useRef(0);
    useEffect(() => {
        const current = ++generation.current;
        setModules([]);
        setNotice('');
        if (!guildId) return;
        setLoading(true);
        setError('');
        api.get<ModuleRecord[]>(`/guilds/${guildId}/modules`)
            .then((response) => {
                if (current === generation.current) setModules(response.data);
            })
            .catch(() => {
                if (current === generation.current)
                    setError(
                        'Server access or settings are unavailable. Refresh your login and check the bot installation.'
                    );
            })
            .finally(() => {
                if (current === generation.current) setLoading(false);
            });
        return () => {
            generation.current = current + 1;
        };
    }, [guildId]);
    async function reload(message?: string) {
        const current = generation.current;
        const response = await api.get<ModuleRecord[]>(
            `/guilds/${guildId}/modules`
        );
        if (current === generation.current) {
            setModules(response.data);
            if (message) setNotice(message);
        }
    }
    async function toggle(module: ModuleRecord) {
        setBusy(module.id);
        setError('');
        setNotice('');
        try {
            await api.put(`/guilds/${guildId}/modules/${module.id}`, {
                enabled: !module.settings.enabled,
                config: module.settings.config,
            });
            await reload('Settings saved for this server.');
        } catch {
            setError(
                'Settings were not saved. Check your server permissions and try again.'
            );
        } finally {
            setBusy(null);
        }
    }
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
                description="Choose a server and enable the modules your community needs. Modules start disabled, and settings are shared with /settings in Discord."
                actions={
                    guildId ? (
                        <>
                            <Link
                                to="/overview"
                                className="bl-button bl-button-secondary bl-button-sm"
                            >
                                Overview
                            </Link>
                            <Link
                                to="/moderation"
                                className="bl-button bl-button-secondary bl-button-sm"
                            >
                                Moderation cases
                            </Link>
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
                                            guildId={guildId}
                                            module={module}
                                            busy={busy}
                                            onToggle={(item) => {
                                                void toggle(item);
                                            }}
                                            onSaved={reload}
                                            onBusy={(value) =>
                                                setBusy(
                                                    value ? module.id : null
                                                )
                                            }
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
