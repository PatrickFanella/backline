import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { ModuleRecord } from '../components/ModuleSettings';
import ServerSwitcher from '../components/ServerSwitcher';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { Page, PageHeader, Section } from '../components/ui/Page';
import { Stat } from '../components/ui/Stat';
import { useServers } from '../hooks/useServers';
import api from '../lib/api';
import {
    moduleCategories,
    moduleCategory,
    moduleName,
    modulePath,
    moduleState,
    type ModuleState,
} from '../lib/modules';
import { useGuild } from '../store/guild';

type Case = {
    id: string;
    action: string;
    state: string;
    reason: string;
    createdAt: string;
};

type ApiStatus = {
    status: string;
    timestamp: string;
};

const stateTone: Record<ModuleState, 'success' | 'neutral' | 'warning'> = {
    enabled: 'success',
    disabled: 'neutral',
    blocked: 'warning',
};
const stateLabel: Record<ModuleState, string> = {
    enabled: 'On',
    disabled: 'Off',
    blocked: 'Blocked',
};

export default function Overview() {
    const guildId = useGuild((state) => state.guildId);
    const {
        servers,
        loading: serversLoading,
        error: serversError,
    } = useServers('passive');
    const [modules, setModules] = useState<ModuleRecord[] | null>(null);
    const [cases, setCases] = useState<Case[] | null>(null);
    const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
    const [error, setError] = useState('');
    const server = servers.find((item) => item.id === guildId);
    useEffect(() => {
        let active = true;
        setModules(null);
        setCases(null);
        setError('');
        if (!guildId) return;
        api.get<ModuleRecord[]>(`/guilds/${guildId}/modules`)
            .then((response) => {
                if (active) setModules(response.data);
            })
            .catch(() => {
                if (active)
                    setError(
                        'Module settings are unavailable for this server right now.'
                    );
            });
        api.get<Case[]>(`/guilds/${guildId}/moderation/cases`)
            .then((response) => {
                if (active) setCases(response.data);
            })
            .catch(() => {
                if (active) setCases([]);
            });
        return () => {
            active = false;
        };
    }, [guildId]);
    useEffect(() => {
        let active = true;
        api.get<ApiStatus>('/status')
            .then((response) => {
                if (active) setApiStatus(response.data);
            })
            .catch(() => {
                if (active) setApiStatus(null);
            });
        return () => {
            active = false;
        };
    }, []);
    const enabled = modules?.filter((module) => module.settings.enabled) ?? [];
    const blocked =
        modules?.filter(
            (module) => !module.operatorReady && !module.settings.enabled
        ) ?? [];
    const pending =
        cases?.filter(
            (item) => !['DELIVERED', 'FAILED', 'CANCELLED'].includes(item.state)
        ) ?? [];
    const failed = cases?.filter((item) => item.state === 'FAILED') ?? [];
    const recent = cases?.slice(0, 5) ?? [];
    return (
        <Page>
            <PageHeader
                eyebrow="Backline · Overview"
                title={server ? server.name : 'Your servers'}
                description="What is switched on for this server, what needs attention, and where to go next."
                actions={
                    <Link
                        to="/servers"
                        className="bl-button bl-button-primary bl-button-sm"
                    >
                        Server setup
                    </Link>
                }
            />
            {(error || serversError) && (
                <Alert tone="danger" role="alert">
                    {error || serversError}
                </Alert>
            )}
            {serversLoading && <p role="status">Loading your servers…</p>}
            {!serversLoading && !servers.length && !serversError && (
                <EmptyState
                    title="No manageable servers found"
                    actions={
                        <Link
                            to="/servers"
                            className="bl-button bl-button-secondary bl-button-sm"
                        >
                            Open server setup
                        </Link>
                    }
                >
                    <p>
                        The bot must be installed, and your Discord account must
                        have Manage Server permission.
                    </p>
                </EmptyState>
            )}
            <ServerSwitcher servers={servers} />
            {guildId && (
                <>
                    <dl className="bl-stat-grid">
                        <Stat
                            label="Modules enabled"
                            value={
                                modules
                                    ? `${enabled.length}/${modules.length}`
                                    : '…'
                            }
                            note="Modules start disabled per server."
                        />
                        <Stat
                            label="Waiting on operator"
                            value={modules ? blocked.length : '…'}
                            note={
                                blocked.length
                                    ? 'Need Discord intents and a bot restart.'
                                    : 'All modules can be enabled.'
                            }
                        />
                        <Stat
                            label="Actions in flight"
                            value={cases ? pending.length : '…'}
                            note="Queued moderation actions not yet delivered."
                        />
                        <Stat
                            label="API services"
                            value={
                                apiStatus
                                    ? apiStatus.status === 'healthy'
                                        ? 'Operational'
                                        : apiStatus.status
                                    : 'Unknown'
                            }
                            note={
                                <Link to="/status" className="text-bl-accent">
                                    Service status
                                </Link>
                            }
                        />
                    </dl>
                    <div className="bl-overview-layout">
                        <Section
                            id="modules"
                            title="Modules"
                            description="Open a module to change its settings."
                            actions={
                                <Link
                                    to="/servers"
                                    className="text-bl-accent text-sm"
                                >
                                    All modules
                                </Link>
                            }
                        >
                            {modules === null && !error && (
                                <p className="text-bl-muted">
                                    Loading modules…
                                </p>
                            )}
                            {modules && modules.length > 0 && (
                                <div className="bl-category-grid">
                                    {moduleCategories.map((category) => {
                                        const items = modules.filter(
                                            (module) =>
                                                moduleCategory(module.id) ===
                                                category.id
                                        );
                                        if (!items.length) return null;
                                        const on = items.filter(
                                            (module) => module.settings.enabled
                                        ).length;
                                        return (
                                            <section
                                                key={category.id}
                                                className="bl-card p-4 flex flex-col gap-3"
                                                aria-labelledby={`overview-${category.id}`}
                                            >
                                                <div className="flex items-baseline justify-between gap-3">
                                                    <h3
                                                        id={`overview-${category.id}`}
                                                        className="bl-eyebrow-app"
                                                    >
                                                        {category.title}
                                                    </h3>
                                                    <span className="text-xs text-bl-muted whitespace-nowrap">
                                                        {on} of {items.length}{' '}
                                                        on
                                                    </span>
                                                </div>
                                                <ul className="bl-module-nav">
                                                    {items.map((module) => {
                                                        const state =
                                                            moduleState(
                                                                module.settings,
                                                                module.operatorReady
                                                            );
                                                        return (
                                                            <li key={module.id}>
                                                                <Link
                                                                    to={modulePath(
                                                                        module.id
                                                                    )}
                                                                >
                                                                    <span>
                                                                        {moduleName(
                                                                            module.id
                                                                        )}
                                                                    </span>
                                                                    <Badge
                                                                        tone={
                                                                            stateTone[
                                                                                state
                                                                            ]
                                                                        }
                                                                    >
                                                                        {
                                                                            stateLabel[
                                                                                state
                                                                            ]
                                                                        }
                                                                    </Badge>
                                                                </Link>
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            </section>
                                        );
                                    })}
                                </div>
                            )}
                        </Section>
                        <div className="space-y-6">
                            <Section id="attention" title="Needs attention">
                                {modules &&
                                    !blocked.length &&
                                    !failed.length && (
                                        <p className="bl-card p-4 text-sm text-bl-muted">
                                            Nothing needs attention right now.
                                        </p>
                                    )}
                                {blocked.length > 0 && (
                                    <Alert
                                        tone="warning"
                                        title="Waiting on the operator"
                                    >
                                        {blocked
                                            .map((module) =>
                                                moduleName(module.id)
                                            )
                                            .join(', ')}{' '}
                                        need Discord intents enabled by the bot
                                        operator before they can be switched on.
                                    </Alert>
                                )}
                                {failed.length > 0 && (
                                    <Alert tone="danger" title="Failed actions">
                                        {failed.length === 1
                                            ? 'One moderation action'
                                            : `${failed.length} moderation actions`}{' '}
                                        could not be delivered.{' '}
                                        <Link
                                            to="/moderation"
                                            className="text-bl-accent underline"
                                        >
                                            Review cases
                                        </Link>
                                    </Alert>
                                )}
                            </Section>
                            <Section
                                id="recent-cases"
                                title="Recent cases"
                                actions={
                                    <Link
                                        to="/moderation"
                                        className="text-bl-accent text-sm"
                                    >
                                        All cases
                                    </Link>
                                }
                            >
                                {cases === null && (
                                    <p className="text-bl-muted">
                                        Loading cases…
                                    </p>
                                )}
                                {cases && recent.length === 0 && (
                                    <EmptyState as="h3" title="No cases yet">
                                        <p>
                                            Queued moderation actions appear
                                            here.
                                        </p>
                                    </EmptyState>
                                )}
                                {recent.length > 0 && (
                                    <ol className="bl-card divide-y divide-bl-border/40">
                                        {recent.map((item) => (
                                            <li
                                                key={item.id}
                                                className="p-4 flex items-start justify-between gap-3"
                                            >
                                                <div className="min-w-0">
                                                    <p className="font-semibold">
                                                        {item.action}
                                                    </p>
                                                    <p className="text-sm text-bl-muted truncate">
                                                        {item.reason}
                                                    </p>
                                                    <p className="text-xs text-bl-muted">
                                                        {new Date(
                                                            item.createdAt
                                                        ).toLocaleString()}
                                                    </p>
                                                </div>
                                                <Badge
                                                    tone={
                                                        item.state ===
                                                        'DELIVERED'
                                                            ? 'success'
                                                            : [
                                                                    'FAILED',
                                                                    'CANCELLED',
                                                                ].includes(
                                                                    item.state
                                                                )
                                                              ? 'danger'
                                                              : 'neutral'
                                                    }
                                                >
                                                    {item.state}
                                                </Badge>
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </Section>
                        </div>
                    </div>
                </>
            )}
        </Page>
    );
}
