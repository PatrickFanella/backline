import { useState } from 'react';
import type { FormEvent } from 'react';

import api from '../lib/api';

type Command = {
    name: string;
    response: { content: string; title: string; description: string };
    requiredRoles: string[];
};
type Props = {
    guildId: string;
    enabled: boolean;
    config: Record<string, unknown>;
    onSaved: () => Promise<void>;
    onBusy: (value: boolean) => void;
};
export default function CustomCommandsConfig({
    guildId,
    enabled,
    config,
    onSaved,
    onBusy,
}: Props) {
    const [commands, setCommands] = useState<Command[]>(
        Array.isArray(config.commands) ? (config.commands as Command[]) : []
    );
    const [busy, setBusy] = useState(false),
        [notice, setNotice] = useState('');
    function update(index: number, change: Partial<Command>) {
        setCommands((rows) =>
            rows.map((row, i) => (index === i ? { ...row, ...change } : row))
        );
    }
    async function save(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        onBusy(true);
        setNotice('');
        try {
            await api.put(`/guilds/${guildId}/modules/custom-commands`, {
                enabled,
                config: { commands },
            });
            await onSaved();
            setNotice('Custom commands saved.');
        } catch {
            setNotice(
                'Commands were not saved. Check names, duplicate entries, role IDs and supported substitutions.'
            );
        } finally {
            setBusy(false);
            onBusy(false);
        }
    }
    return (
        <form
            onSubmit={(event) => {
                void save(event);
            }}
            className="space-y-3 mt-4"
        >
            <fieldset disabled={busy} className="space-y-3">
                <legend className="bl-legend">Custom command replies</legend>
                <p className="text-sm text-bl-muted">
                    Members use /custom name in Discord. Replies are visible
                    only to the member who ran the command. Use {'{user}'},{' '}
                    {'{server}'} and {'{channel}'} to insert names. Templates do
                    not run code, and mentions cannot notify users or roles.
                </p>
                {commands.map((command, index) => (
                    <fieldset
                        key={index}
                        className="space-y-2 border border-bl-border rounded p-3"
                    >
                        <legend>Command {index + 1}</legend>
                        <label className="bl-label">
                            Command name
                            <input
                                required
                                pattern="(?:[a-z0-9_]|-){1,32}"
                                maxLength={32}
                                value={command.name}
                                onChange={(event) =>
                                    update(index, { name: event.target.value })
                                }
                                className="bl-input"
                            />
                        </label>
                        <label className="bl-label">
                            Text reply
                            <textarea
                                maxLength={1800}
                                value={command.response.content}
                                onChange={(event) =>
                                    update(index, {
                                        response: {
                                            ...command.response,
                                            content: event.target.value,
                                        },
                                    })
                                }
                                className="bl-input"
                            />
                        </label>
                        <label className="bl-label">
                            Embed title
                            <input
                                maxLength={200}
                                value={command.response.title}
                                onChange={(event) =>
                                    update(index, {
                                        response: {
                                            ...command.response,
                                            title: event.target.value,
                                        },
                                    })
                                }
                                className="bl-input"
                            />
                        </label>
                        <label className="bl-label">
                            Embed description
                            <textarea
                                maxLength={3500}
                                value={command.response.description}
                                onChange={(event) =>
                                    update(index, {
                                        response: {
                                            ...command.response,
                                            description: event.target.value,
                                        },
                                    })
                                }
                                className="bl-input"
                            />
                        </label>
                        <label className="bl-label">
                            Required role IDs, separated by commas
                            <input
                                value={command.requiredRoles.join(', ')}
                                onChange={(event) =>
                                    update(index, {
                                        requiredRoles: event.target.value
                                            .split(',')
                                            .map((role) => role.trim())
                                            .filter(Boolean),
                                    })
                                }
                                className="bl-input"
                            />
                        </label>
                        <p className="text-sm text-bl-muted">
                            Leave roles empty to allow all members. With roles
                            configured, a member must currently hold at least
                            one.
                        </p>
                        <button
                            type="button"
                            onClick={() =>
                                setCommands((rows) =>
                                    rows.filter((_, i) => i !== index)
                                )
                            }
                            className="bl-button bl-button-secondary bl-button-sm"
                        >
                            Remove command {index + 1}
                        </button>
                    </fieldset>
                ))}
                <button
                    type="button"
                    disabled={commands.length >= 20}
                    onClick={() =>
                        setCommands((rows) => [
                            ...rows,
                            {
                                name: '',
                                response: {
                                    content: '',
                                    title: '',
                                    description: '',
                                },
                                requiredRoles: [],
                            },
                        ])
                    }
                    className="bl-button bl-button-secondary bl-button-sm"
                >
                    Add custom command
                </button>
                <button
                    type="submit"
                    className="bl-button bl-button-secondary bl-button-sm ml-2"
                >
                    {busy ? 'Saving…' : 'Save custom commands'}
                </button>
            </fieldset>
            {notice && (
                <p role="status" className="bl-form-notice">
                    {notice}
                </p>
            )}
        </form>
    );
}
