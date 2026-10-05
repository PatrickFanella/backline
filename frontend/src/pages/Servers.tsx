import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import AntiSpamConfig from '../components/AntiSpamConfig';
import AudioConfig from '../components/AudioConfig';
import CommunityReportsConfig from '../components/CommunityReportsConfig';
import GiveawayConfig from '../components/GiveawayConfig';
import LevelingConfig from '../components/LevelingConfig';
import OnboardingConfig from '../components/OnboardingConfig';
import SelfRolesConfig from '../components/SelfRolesConfig';
import ServerModuleConfig from '../components/ServerModuleConfig';
import TicketConfig from '../components/TicketConfig';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import api from '../lib/api';
import { useGuild } from '../store/guild';

type Server = { id: string; name: string; icon: string | null };
type Module = {
    id: string;
    description: string;
    operatorReady: boolean;
    permissions: string[];
    intents: number[];
    settings: { enabled: boolean; config: Record<string, unknown> };
};
export default function Servers() {
    const [servers, setServers] = useState<Server[]>([]);
    const [modules, setModules] = useState<Module[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const { guildId, selectGuild } = useGuild();
    const generation = useRef(0);
    useEffect(() => {
        let active = true;
        api.get<Server[]>('/guilds')
            .then((response) => {
                if (!active) return;
                setServers(response.data);
                const current = useGuild.getState().guildId;
                if (!response.data.some((server) => server.id === current))
                    selectGuild(response.data[0]?.id ?? null);
            })
            .catch(() => {
                if (active)
                    setError(
                        'Could not verify your server permissions. Sign in again or retry.'
                    );
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [selectGuild]);
    useEffect(() => {
        const current = ++generation.current;
        setModules([]);
        setNotice('');
        if (!guildId) return;
        setLoading(true);
        setError('');
        api.get<Module[]>(`/guilds/${guildId}/modules`)
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
    async function toggle(module: Module) {
        const current = generation.current;
        setBusy(module.id);
        setError('');
        setNotice('');
        try {
            await api.put(`/guilds/${guildId}/modules/${module.id}`, {
                enabled: !module.settings.enabled,
                config: module.settings.config,
            });
            const response = await api.get<Module[]>(
                `/guilds/${guildId}/modules`
            );
            if (current === generation.current) {
                setModules(response.data);
                setNotice('Settings saved for this server.');
            }
        } catch {
            if (current === generation.current)
                setError(
                    'Settings were not saved. Check your server permissions and try again.'
                );
        } finally {
            setBusy(null);
        }
    }
    return (
        <main
            id="main-content"
            className="min-h-screen bg-ctp-base text-ctp-text p-4 sm:p-8 pb-64 sm:pb-32"
        >
            <div className="max-w-5xl mx-auto space-y-8">
                <header className="flex justify-between gap-4 items-start">
                    <div>
                        <p className="text-sm text-ctp-subtext0 mb-2">
                            Backline · Server setup
                        </p>
                        <h1 className="text-3xl font-semibold">
                            Set up your server
                        </h1>
                        <p className="text-ctp-subtext1 mt-3">
                            Choose a server and enable the modules your
                            community needs.
                        </p>
                    </div>
                    <ThemeToggle />
                </header>
                {error && (
                    <div
                        role="alert"
                        className="border border-ctp-red rounded-lg p-4"
                    >
                        {error}
                    </div>
                )}
                {notice && (
                    <p role="status" className="text-ctp-green">
                        {notice}
                    </p>
                )}
                {loading && <p role="status">Loading server settings…</p>}
                {!loading && !servers.length && !error && (
                    <section className="border border-ctp-surface1 rounded-lg p-6">
                        <h2 className="text-xl font-medium">
                            No manageable servers found
                        </h2>
                        <p className="mt-3 text-ctp-subtext1">
                            The bot must be installed, and your Discord account
                            must have Manage Server permission. Use /setup
                            inside your server to check its installation.
                        </p>
                    </section>
                )}
                {servers.length > 0 && (
                    <section className="space-y-3">
                        <label
                            htmlFor="server-picker"
                            className="block font-medium"
                        >
                            Server
                        </label>
                        <select
                            id="server-picker"
                            value={guildId ?? ''}
                            onChange={(event) =>
                                selectGuild(event.target.value)
                            }
                            disabled={busy !== null}
                            className="w-full sm:max-w-md bg-ctp-surface0 border border-ctp-surface2 rounded-lg p-3 focus:ring-2 focus:ring-ctp-blue"
                        >
                            {servers.map((server) => (
                                <option key={server.id} value={server.id}>
                                    {server.name}
                                </option>
                            ))}
                        </select>
                    </section>
                )}
                {guildId && (
                    <section
                        aria-labelledby="module-heading"
                        className="space-y-4"
                    >
                        <h2
                            id="module-heading"
                            className="text-xl font-semibold"
                        >
                            Server modules
                        </h2>
                        <p className="text-ctp-subtext1">
                            Modules start disabled. Settings apply to the
                            selected server and are shared with /settings in
                            Discord.
                        </p>
                        {modules.map((module) => (
                            <article
                                key={module.id}
                                className="border border-ctp-surface1 bg-ctp-mantle rounded-lg p-5 flex flex-col sm:flex-row gap-5 justify-between"
                            >
                                <div className="space-y-2">
                                    <h3 className="font-semibold">
                                        {module.id === 'activity'
                                            ? 'Activity reports'
                                            : module.id === 'operator-plugins'
                                              ? 'Extensions'
                                              : module.id.replace(/-/g, ' ')}
                                    </h3>
                                    <p className="text-ctp-subtext1">
                                        {module.description}
                                    </p>
                                    {!module.operatorReady && (
                                        <p className="text-ctp-yellow">
                                            This module needs the operator to
                                            enable its Discord intents and
                                            restart the bot.
                                        </p>
                                    )}
                                    {module.id === 'audio' && (
                                        <AudioConfig
                                            key={`${guildId}:audio:${JSON.stringify(module.settings.config)}`}
                                            guildId={guildId}
                                            enabled={module.settings.enabled}
                                            config={module.settings.config}
                                            onBusy={(value) =>
                                                setBusy(
                                                    value ? module.id : null
                                                )
                                            }
                                            onSaved={async () => {
                                                const current =
                                                    generation.current;
                                                const response = await api.get<
                                                    Module[]
                                                >(`/guilds/${guildId}/modules`);
                                                if (
                                                    current ===
                                                    generation.current
                                                )
                                                    setModules(response.data);
                                            }}
                                        />
                                    )}
                                    {module.id === 'community-reports' && (
                                        <CommunityReportsConfig
                                            key={`${guildId}:community-reports:${JSON.stringify(module.settings.config)}`}
                                            guildId={guildId}
                                            enabled={module.settings.enabled}
                                            config={module.settings.config}
                                            onBusy={(value) =>
                                                setBusy(
                                                    value ? module.id : null
                                                )
                                            }
                                            onSaved={async () => {
                                                const current =
                                                    generation.current;
                                                const response = await api.get<
                                                    Module[]
                                                >(`/guilds/${guildId}/modules`);
                                                if (
                                                    current ===
                                                    generation.current
                                                )
                                                    setModules(response.data);
                                            }}
                                        />
                                    )}
                                    {module.id === 'leveling' && (
                                        <LevelingConfig
                                            key={`${guildId}:leveling:${JSON.stringify(module.settings.config)}`}
                                            guildId={guildId}
                                            enabled={module.settings.enabled}
                                            config={module.settings.config}
                                            onBusy={(value) =>
                                                setBusy(
                                                    value ? module.id : null
                                                )
                                            }
                                            onSaved={async () => {
                                                const current =
                                                    generation.current;
                                                const response = await api.get<
                                                    Module[]
                                                >(`/guilds/${guildId}/modules`);
                                                if (
                                                    current ===
                                                    generation.current
                                                )
                                                    setModules(response.data);
                                            }}
                                        />
                                    )}
                                    {module.id === 'giveaways' && (
                                        <GiveawayConfig
                                            key={`${guildId}:giveaways:${JSON.stringify(module.settings.config)}`}
                                            guildId={guildId}
                                            enabled={module.settings.enabled}
                                            config={module.settings.config}
                                            onBusy={(value) =>
                                                setBusy(
                                                    value ? module.id : null
                                                )
                                            }
                                            onSaved={async () => {
                                                const current =
                                                    generation.current;
                                                const response = await api.get<
                                                    Module[]
                                                >(`/guilds/${guildId}/modules`);
                                                if (
                                                    current ===
                                                    generation.current
                                                )
                                                    setModules(response.data);
                                            }}
                                        />
                                    )}
                                    {module.id === 'tickets' && (
                                        <TicketConfig
                                            key={`${guildId}:tickets:${JSON.stringify(module.settings.config)}`}
                                            guildId={guildId}
                                            enabled={module.settings.enabled}
                                            config={module.settings.config}
                                            onBusy={(value) =>
                                                setBusy(
                                                    value ? module.id : null
                                                )
                                            }
                                            onSaved={async () => {
                                                const current =
                                                    generation.current;
                                                const response = await api.get<
                                                    Module[]
                                                >(`/guilds/${guildId}/modules`);
                                                if (
                                                    current ===
                                                    generation.current
                                                )
                                                    setModules(response.data);
                                            }}
                                        />
                                    )}
                                    {module.id === 'onboarding' && (
                                        <OnboardingConfig
                                            key={`${guildId}:onboarding:${JSON.stringify(module.settings.config)}`}
                                            guildId={guildId}
                                            enabled={module.settings.enabled}
                                            config={module.settings.config}
                                            onBusy={(value) =>
                                                setBusy(
                                                    value ? module.id : null
                                                )
                                            }
                                            onSaved={async () => {
                                                const current =
                                                    generation.current;
                                                const response = await api.get<
                                                    Module[]
                                                >(`/guilds/${guildId}/modules`);
                                                if (
                                                    current ===
                                                    generation.current
                                                ) {
                                                    setModules(response.data);
                                                    setNotice(
                                                        'Onboarding settings saved for this server.'
                                                    );
                                                }
                                            }}
                                        />
                                    )}
                                    {module.id === 'self-roles' && (
                                        <SelfRolesConfig
                                            key={`${guildId}:self-roles:${JSON.stringify(module.settings.config)}`}
                                            guildId={guildId}
                                            enabled={module.settings.enabled}
                                            config={module.settings.config}
                                            onBusy={(value) =>
                                                setBusy(
                                                    value ? module.id : null
                                                )
                                            }
                                            onSaved={async () => {
                                                const current =
                                                    generation.current;
                                                const response = await api.get<
                                                    Module[]
                                                >(`/guilds/${guildId}/modules`);
                                                if (
                                                    current ===
                                                    generation.current
                                                ) {
                                                    setModules(response.data);
                                                    setNotice(
                                                        'Role settings saved for this server.'
                                                    );
                                                }
                                            }}
                                        />
                                    )}
                                    {module.id === 'anti-spam' && (
                                        <AntiSpamConfig
                                            key={`${guildId}:anti-spam:${JSON.stringify(module.settings.config)}`}
                                            guildId={guildId}
                                            enabled={module.settings.enabled}
                                            config={module.settings.config}
                                            onBusy={(value) =>
                                                setBusy(
                                                    value ? module.id : null
                                                )
                                            }
                                            onSaved={async () => {
                                                const current =
                                                    generation.current;
                                                const response = await api.get<
                                                    Module[]
                                                >(`/guilds/${guildId}/modules`);
                                                if (
                                                    current ===
                                                    generation.current
                                                ) {
                                                    setModules(response.data);
                                                    setNotice(
                                                        'Anti-spam policy saved for this server.'
                                                    );
                                                }
                                            }}
                                        />
                                    )}
                                    <ServerModuleConfig
                                        key={`audit-config:${guildId}:${module.id}:${JSON.stringify(module.settings.config)}`}
                                        guildId={guildId}
                                        moduleId={module.id}
                                        enabled={module.settings.enabled}
                                        config={module.settings.config}
                                        onBusy={(value) =>
                                            setBusy(value ? module.id : null)
                                        }
                                        onSaved={async () => {
                                            const current = generation.current;
                                            const response = await api.get<
                                                Module[]
                                            >(`/guilds/${guildId}/modules`);
                                            if (
                                                current === generation.current
                                            ) {
                                                setModules(response.data);
                                                setNotice(
                                                    'Log settings saved for this server.'
                                                );
                                            }
                                        }}
                                    />
                                    <p className="text-sm text-ctp-subtext0">
                                        Use /setup in Discord to check the bot’s
                                        required permissions.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    aria-pressed={module.settings.enabled}
                                    disabled={
                                        busy !== null ||
                                        (!module.operatorReady &&
                                            !module.settings.enabled)
                                    }
                                    onClick={() => {
                                        void toggle(module);
                                    }}
                                    className="self-start shrink-0 border border-ctp-surface2 rounded-lg px-4 py-2 focus:ring-2 focus:ring-ctp-blue disabled:opacity-50"
                                >
                                    {busy === module.id
                                        ? 'Saving…'
                                        : module.settings.enabled
                                          ? 'Disable'
                                          : 'Enable'}
                                </button>
                            </article>
                        ))}
                    </section>
                )}
                <footer className="flex flex-wrap gap-5 text-ctp-blue">
                    {guildId && <Link to="/moderation">Moderation cases</Link>}
                    {guildId && (
                        <Link to="/observed-activity">
                            Observed activity reports
                        </Link>
                    )}
                    <Link to="/status">Service status</Link>
                </footer>
            </div>
        </main>
    );
}
