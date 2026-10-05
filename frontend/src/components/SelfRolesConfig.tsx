import { useState } from 'react';
import type { FormEvent } from 'react';

import api from '../lib/api';

type Option = {
    roleId: string;
    label: string;
    emoji?: string;
    group?: string;
    requires: string[];
};
type Props = {
    guildId: string;
    enabled: boolean;
    config: Record<string, unknown>;
    onSaved: () => Promise<void>;
    onBusy: (value: boolean) => void;
};
export default function SelfRolesConfig({
    guildId,
    enabled,
    config,
    onSaved,
    onBusy,
}: Props) {
    const [channel, setChannel] = useState(String(config.channelId ?? ''));
    const [title, setTitle] = useState(
        String(config.title ?? 'Choose your roles')
    );
    const [style, setStyle] = useState(String(config.style ?? 'buttons'));
    const [roles, setRoles] = useState<Option[]>(
        Array.isArray(config.roles) ? (config.roles as Option[]) : []
    );
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    function edit(index: number, field: Partial<Option>) {
        setRoles((current) =>
            current.map((role, position) =>
                position === index ? { ...role, ...field } : role
            )
        );
    }
    async function save(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        onBusy(true);
        setNotice('');
        try {
            await api.put(`/guilds/${guildId}/modules/self-roles`, {
                enabled,
                config: { channelId: channel, title, style, roles },
            });
            await onSaved();
        } catch {
            setNotice(
                'Role settings were not saved. Check IDs and your current Manage Roles permission.'
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
                <legend className="font-medium">
                    Self-service role settings
                </legend>
                <label className="block">
                    Role panel channel ID
                    <input
                        className="block w-full p-2 bg-ctp-surface0 rounded"
                        value={channel}
                        onChange={(event) => setChannel(event.target.value)}
                        required
                        pattern="[0-9]{17,20}"
                    />
                </label>
                <label className="block">
                    Panel title
                    <input
                        className="block w-full p-2 bg-ctp-surface0 rounded"
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        required
                        maxLength={100}
                    />
                </label>
                <label className="block">
                    Control style
                    <select
                        className="block p-2 bg-ctp-surface0 rounded"
                        value={style}
                        onChange={(event) => setStyle(event.target.value)}
                    >
                        <option value="buttons">Buttons</option>
                        <option value="select">Select menu</option>
                        <option value="reactions">Unicode reactions</option>
                    </select>
                </label>
                {roles.map((role, index) => (
                    <fieldset
                        key={index}
                        className="border border-ctp-surface2 rounded p-3 space-y-2"
                    >
                        <legend>Role {index + 1}</legend>
                        <label className="block">
                            Role ID
                            <input
                                className="block w-full p-2 bg-ctp-surface0 rounded"
                                value={role.roleId}
                                onChange={(event) =>
                                    edit(index, { roleId: event.target.value })
                                }
                                required
                                pattern="[0-9]{17,20}"
                            />
                        </label>
                        <label className="block">
                            Label
                            <input
                                className="block w-full p-2 bg-ctp-surface0 rounded"
                                value={role.label}
                                onChange={(event) =>
                                    edit(index, { label: event.target.value })
                                }
                                required
                                maxLength={80}
                            />
                        </label>
                        {style === 'reactions' && (
                            <label className="block">
                                Unicode emoji
                                <input
                                    className="block w-full p-2 bg-ctp-surface0 rounded"
                                    value={role.emoji ?? ''}
                                    onChange={(event) =>
                                        edit(index, {
                                            emoji: event.target.value,
                                        })
                                    }
                                    required
                                    maxLength={64}
                                />
                            </label>
                        )}
                        <label className="block">
                            Exclusive group (optional)
                            <input
                                className="block w-full p-2 bg-ctp-surface0 rounded"
                                value={role.group ?? ''}
                                onChange={(event) =>
                                    edit(index, { group: event.target.value })
                                }
                                maxLength={40}
                            />
                        </label>
                        <label className="block">
                            Required role IDs, separated by commas
                            <input
                                className="block w-full p-2 bg-ctp-surface0 rounded"
                                value={role.requires.join(', ')}
                                onChange={(event) =>
                                    edit(index, {
                                        requires: event.target.value
                                            .split(',')
                                            .map((id) => id.trim())
                                            .filter(Boolean),
                                    })
                                }
                            />
                        </label>
                        <button
                            type="button"
                            className="border border-ctp-surface2 rounded p-2"
                            onClick={() =>
                                setRoles((current) =>
                                    current.filter(
                                        (_, position) => position !== index
                                    )
                                )
                            }
                        >
                            Remove option {index + 1}
                        </button>
                    </fieldset>
                ))}
                <button
                    type="button"
                    disabled={roles.length >= 20}
                    className="border border-ctp-surface2 rounded p-2"
                    onClick={() =>
                        setRoles((current) => [
                            ...current,
                            { roleId: '', label: '', requires: [] },
                        ])
                    }
                >
                    Add role option
                </button>
                <button
                    type="submit"
                    className="border border-ctp-surface2 rounded p-2 ml-2"
                >
                    {busy ? 'Saving…' : 'Save role settings'}
                </button>
                <p className="text-sm text-ctp-subtext0">
                    Enable this module, then use /roles-panel in Discord to
                    publish. A configuration change makes earlier panels
                    unavailable. Reaction panels need one unique Unicode emoji
                    per role and the bot needs Add Reactions and Read Message
                    History. Only basic chat and voice roles below the bot can
                    be offered.
                </p>
            </fieldset>
            {notice && <p role="status">{notice}</p>}
        </form>
    );
}
