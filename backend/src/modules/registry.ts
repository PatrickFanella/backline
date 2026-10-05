import { Prisma } from '@prisma/client';
import { GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { z } from 'zod';

import { audioConfig } from '../audio/config';
import {
    antiSpamConfig,
    auditConfig,
    onboardingConfig,
    selfRolesConfig,
    ticketConfig,
    giveawayConfig,
    levelingConfig,
    communityReportsConfig,
} from '../community/config';
import {
    afkConfig,
    birthdaysConfig,
    suggestionsConfig,
} from '../community/memberUtilityConfig';
import { customCommandsConfig } from '../community/utilityTemplates';
import { scheduledUtilitiesConfig } from '../community/utilityTime';
import { db } from '../db';
import { economyConfig } from '../economy/config';
import { entertainmentConfig } from '../entertainment/catalog';
import { integrationsConfig } from '../integrations/config';
import { recoveryConfig } from '../recovery/config';
import { env } from '../utils/env';
import { toInputJson } from '../utils/prismaJson';
import { workflowsConfig } from '../workflows/config';

export interface ModuleDefinition {
    id: string;
    description: string;
    version: number;
    schema: z.ZodType;
    permissions: bigint[];
    intents: GatewayIntentBits[];
    commands: string[];
    actionPermissions?: Record<string, bigint[]>;
    pendingJobPolicy: 'cancel';
}

export class ModuleRegistry {
    private readonly definitions = new Map<string, ModuleDefinition>();
    register(definition: ModuleDefinition): void {
        if (
            !/^[a-z][a-z0-9-]{0,40}$/.test(definition.id) ||
            this.definitions.has(definition.id)
        ) {
            throw new Error('Invalid or duplicate module');
        }
        this.definitions.set(definition.id, definition);
    }
    list(): ModuleDefinition[] {
        return [...this.definitions.values()];
    }
    get(id: string): ModuleDefinition {
        const definition = this.definitions.get(id);
        if (!definition) throw new Error('Unknown module');
        return definition;
    }
    async configure(
        guildId: string,
        moduleId: string,
        enabled: boolean,
        config: unknown,
        actorId?: string
    ): Promise<void> {
        const definition = this.get(moduleId);
        if (env.BOT_GUILD_IDS.length && !env.BOT_GUILD_IDS.includes(guildId))
            throw new Error('Server excluded by operator');
        if (enabled && moduleId === 'activity' && !env.BOT_ACTIVITY_INTENTS)
            throw new Error('Activity Gateway intents unavailable');
        if (enabled && !moduleOperatorReady(definition))
            throw new Error('Required Gateway intents unavailable');
        if (moduleId === 'workflows') {
            const raw = z
                .object({
                    rules: z
                        .array(z.record(z.string(), z.unknown()))
                        .max(10)
                        .default([]),
                })
                .strict()
                .parse(config);
            if (raw.rules.length && !actorId)
                throw new Error(
                    'Workflow configuration requires manager attribution'
                );
            config = { rules: raw.rules.map((rule) => ({ ...rule, actorId })) };
            if (
                enabled &&
                raw.rules.some((rule) => rule.trigger === 'member_join') &&
                !env.BOT_MEMBER_INTENTS
            )
                throw new Error(
                    'Member Gateway intent required for join workflows'
                );
        }
        const parsed = definition.schema.parse(config);
        if (
            enabled &&
            moduleId === 'audit-log' &&
            !auditConfig.parse(parsed).channelId
        )
            throw new Error('Audit channel required');
        if (
            enabled &&
            moduleId === 'leveling' &&
            levelingConfig.parse(parsed).voiceEnabled &&
            !env.BOT_VOICE_INTENT
        )
            throw new Error('Voice Gateway intent unavailable');
        const validated = toInputJson(definition.schema.parse(config));
        const installation = await db.guildInstallation.findUnique({
            where: { guildId },
        });
        if (!installation?.active)
            throw new Error('Bot installation unavailable');
        if (
            moduleId === 'leveling' ||
            moduleId === 'community-reports' ||
            moduleId === 'scheduled-utilities' ||
            moduleId === 'polls' ||
            moduleId === 'suggestions' ||
            moduleId === 'afk' ||
            moduleId === 'birthdays' ||
            moduleId === 'integrations' ||
            moduleId === 'workflows' ||
            moduleId === 'recovery' ||
            moduleId === 'economy' ||
            moduleId === 'entertainment'
        ) {
            await db.$transaction(async (tx) => {
                await tx.$queryRaw(
                    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
                );
                await tx.guildModuleConfig.upsert({
                    where: { guildId_moduleId: { guildId, moduleId } },
                    create: {
                        guildId,
                        moduleId,
                        enabled,
                        config: validated,
                        version: definition.version,
                    },
                    update: {
                        enabled,
                        config: validated,
                        version: definition.version,
                    },
                });
            });
            return;
        }
        if (moduleId === 'tickets') {
            if (ticketConfig.parse(parsed).staffRoles.includes(guildId))
                throw new Error('Everyone cannot be ticket staff');
            await db.$transaction(async (tx) => {
                await tx.$queryRaw(
                    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
                );
                const previous = await tx.guildModuleConfig.findUnique({
                    where: { guildId_moduleId: { guildId, moduleId } },
                });
                if (
                    previous &&
                    JSON.stringify(
                        ticketConfig.parse(previous.config).staffRoles
                    ) !==
                        JSON.stringify(ticketConfig.parse(parsed).staffRoles) &&
                    (await tx.supportTicket.count({
                        where: {
                            guildId,
                            state: { in: ['OPEN', 'CLOSED', 'CREATING'] },
                        },
                    }))
                )
                    throw new Error(
                        'Expire existing tickets before changing staff roles'
                    );
                if (!ticketConfig.parse(parsed).retainContent)
                    await tx.ticketTranscript.deleteMany({
                        where: { guildId, containsContent: true },
                    });
                await tx.guildModuleConfig.upsert({
                    where: { guildId_moduleId: { guildId, moduleId } },
                    create: {
                        guildId,
                        moduleId,
                        enabled,
                        config: validated,
                        version: definition.version,
                    },
                    update: {
                        enabled,
                        config: validated,
                        version: definition.version,
                    },
                });
            });
            return;
        }
        await db.guildModuleConfig.upsert({
            where: { guildId_moduleId: { guildId, moduleId } },
            create: {
                guildId,
                moduleId,
                enabled,
                config: validated,
                version: definition.version,
            },
            update: { enabled, config: validated, version: definition.version },
        });
        if (
            moduleId === 'audit-log' &&
            !auditConfig.parse(parsed).retainContent
        ) {
            await db.$executeRaw`UPDATE "ServerAuditEvent" SET "data" = "data" - 'content' - 'before' - 'after' WHERE "guildId" = ${guildId}`;
        }
    }
    async enabled(guildId: string, moduleId: string): Promise<boolean> {
        const definition = this.get(moduleId);
        if (env.BOT_GUILD_IDS.length && !env.BOT_GUILD_IDS.includes(guildId))
            return false;
        const installation = await db.guildInstallation.findUnique({
            where: { guildId },
        });
        if (!installation?.active) return false;
        const settings = await db.guildModuleConfig.findUnique({
            where: { guildId_moduleId: { guildId, moduleId } },
        });
        return (
            !!settings?.enabled &&
            settings.version === definition.version &&
            moduleOperatorReady(definition) &&
            definition.schema.safeParse(settings.config).success
        );
    }
    async dispatch(
        guildId: string,
        moduleId: string,
        action: () => Promise<unknown>
    ): Promise<void> {
        try {
            if (await this.enabled(guildId, moduleId)) await action();
        } catch {
            // Event errors must not stop unrelated modules or expose Discord request secrets.
            console.warn(`Module event failed: ${moduleId}`);
        }
    }
}

export const moduleRegistry = new ModuleRegistry();
moduleRegistry.register({
    id: 'afk',
    description:
        'Temporary shared away reasons that clear on activity or expire.',
    version: 1,
    schema: afkConfig,
    permissions: [],
    intents: [GatewayIntentBits.GuildMessages],
    commands: ['afk'],
    pendingJobPolicy: 'cancel',
    actionPermissions: {
        notice: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
        ],
    },
});
moduleRegistry.register({
    id: 'birthdays',
    description: 'Opt-in month/day birthday messages without birth years.',
    version: 1,
    schema: birthdaysConfig,
    permissions: [],
    intents: [GatewayIntentBits.GuildMembers],
    commands: ['birthday'],
    pendingJobPolicy: 'cancel',
    actionPermissions: {
        notice: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
        ],
    },
});
moduleRegistry.register({
    id: 'suggestions',
    description: 'Member ideas with changeable votes and staff decisions.',
    version: 1,
    schema: suggestionsConfig,
    permissions: [],
    intents: [],
    commands: ['suggest'],
    pendingJobPolicy: 'cancel',
    actionPermissions: {
        publish: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
        ],
    },
});
moduleRegistry.register({
    id: 'polls',
    description:
        'Native Discord polls with manager creation and member result readback.',
    version: 1,
    schema: z.object({}).strict(),
    permissions: [],
    intents: [],
    commands: ['poll'],
    pendingJobPolicy: 'cancel',
    actionPermissions: {
        send: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.SendPolls,
            PermissionFlagsBits.ReadMessageHistory,
        ],
    },
});
moduleRegistry.register({
    id: 'scheduled-utilities',
    description:
        'Persistent channel reminders and one-time announcements with explicit time zones.',
    version: 1,
    schema: scheduledUtilitiesConfig,
    permissions: [],
    intents: [],
    commands: ['remind', 'announce'],
    pendingJobPolicy: 'cancel',
    actionPermissions: {
        send: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
        ],
    },
});
moduleRegistry.register({
    id: 'custom-commands',
    description:
        'Administrator-authored text and embed replies with fixed substitutions and optional role access.',
    version: 1,
    schema: customCommandsConfig,
    permissions: [],
    intents: [],
    commands: ['custom'],
    pendingJobPolicy: 'cancel',
});
moduleRegistry.register({
    id: 'community-reports',
    description:
        'Observed community totals, collection coverage, join cohorts and scheduled channel counters.',
    version: 1,
    schema: communityReportsConfig,
    permissions: [],
    intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers],
    commands: [],
    pendingJobPolicy: 'cancel',
    actionPermissions: { counters: [PermissionFlagsBits.ManageChannels] },
});
moduleRegistry.register({
    id: 'leveling',
    description:
        'Message and optional voice XP, server leaderboards and eligible role rewards.',
    version: 1,
    schema: levelingConfig,
    permissions: [],
    intents: [
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    commands: ['xp'],
    pendingJobPolicy: 'cancel',
    actionPermissions: { rewards: [PermissionFlagsBits.ManageRoles] },
});
moduleRegistry.register({
    id: 'giveaways',
    description:
        'Persistent giveaway entries, eligibility checks, scheduled draws and recorded rerolls.',
    version: 1,
    schema: giveawayConfig,
    permissions: [],
    intents: [],
    commands: ['giveaway'],
    pendingJobPolicy: 'cancel',
    actionPermissions: {
        publish: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ReadMessageHistory,
        ],
    },
});
moduleRegistry.register({
    id: 'audio',
    description: 'Play approved SomaFM radio stations in your voice channel.',
    version: 1,
    schema: audioConfig,
    permissions: [],
    intents: [GatewayIntentBits.GuildVoiceStates],
    commands: ['radio'],
    pendingJobPolicy: 'cancel',
    actionPermissions: {
        play: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
    },
});
moduleRegistry.register({
    id: 'tickets',
    description:
        'Private support channels, participants, claims and bounded transcripts.',
    version: 1,
    schema: ticketConfig,
    permissions: [],
    intents: [],
    commands: ['ticket', 'ticket-panel'],
    pendingJobPolicy: 'cancel',
    actionPermissions: {
        create: [
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageRoles,
        ],
        transcript: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
        ],
    },
});
moduleRegistry.register({
    id: 'activity',
    description: 'Collect observed member activity for server reports.',
    version: 1,
    schema: z.object({}).strict(),
    permissions: [PermissionFlagsBits.ViewChannel],
    intents: [
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageTyping,
    ],
    commands: [],
    pendingJobPolicy: 'cancel',
});
moduleRegistry.register({
    id: 'operator-plugins',
    description: 'Enable the extensions your bot operator has installed.',
    version: 1,
    schema: z.object({}).strict(),
    permissions: [],
    intents: [],
    commands: [],
    pendingJobPolicy: 'cancel',
});

moduleRegistry.register({
    id: 'moderation',
    actionPermissions: {
        warn: [PermissionFlagsBits.ModerateMembers],
        timeout: [PermissionFlagsBits.ModerateMembers],
        kick: [PermissionFlagsBits.KickMembers],
        ban: [PermissionFlagsBits.BanMembers],
        unban: [PermissionFlagsBits.BanMembers],
        purge: [
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
        ],
    },
    description: 'Moderate members and retain server case history.',
    version: 1,
    schema: z.object({}).strict(),
    permissions: [],
    intents: [],
    commands: ['warn', 'timeout', 'kick', 'ban', 'unban', 'purge', 'cases'],
    pendingJobPolicy: 'cancel',
});

export function configuredIntents(): GatewayIntentBits[] {
    const intents = [GatewayIntentBits.Guilds];
    if (env.BOT_ACTIVITY_INTENTS)
        intents.push(...moduleRegistry.get('activity').intents);
    if (env.BOT_MEMBER_INTENTS) intents.push(GatewayIntentBits.GuildMembers);
    if (env.BOT_VOICE_INTENT) intents.push(GatewayIntentBits.GuildVoiceStates);
    if (env.BOT_MESSAGE_INTENTS) intents.push(GatewayIntentBits.GuildMessages);
    if (env.BOT_MESSAGE_CONTENT_INTENT)
        intents.push(GatewayIntentBits.MessageContent);
    return [...new Set(intents)];
}
export function moduleOperatorReady(module: ModuleDefinition): boolean {
    const intents = configuredIntents();
    return module.intents.every((intent) => intents.includes(intent));
}
moduleRegistry.register({
    id: 'audit-log',
    actionPermissions: {
        send: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
        ],
    },
    description:
        'Send selected member, message and role events to a server log channel.',
    version: 1,
    schema: auditConfig,
    permissions: [],
    intents: [GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
    commands: [],
    pendingJobPolicy: 'cancel',
});

moduleRegistry.register({
    id: 'onboarding',
    actionPermissions: {
        messages: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
        ],
        joinRoles: [PermissionFlagsBits.ManageRoles],
    },
    description:
        'Welcome members, assign eligible join roles and collect rules acknowledgment.',
    version: 1,
    schema: onboardingConfig,
    permissions: [],
    intents: [GatewayIntentBits.GuildMembers],
    commands: [],
    pendingJobPolicy: 'cancel',
});

moduleRegistry.register({
    id: 'self-roles',
    actionPermissions: {
        assignRoles: [PermissionFlagsBits.ManageRoles],
        publish: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
        ],
    },
    description: 'Offer eligible roles through buttons or a selection menu.',
    version: 1,
    schema: selfRolesConfig,
    permissions: [],
    intents: [],
    commands: ['roles-panel'],
    pendingJobPolicy: 'cancel',
});

moduleRegistry.register({
    id: 'anti-spam',
    actionPermissions: { timeouts: [PermissionFlagsBits.ModerateMembers] },
    description:
        'Observe message floods, prohibited content and join bursts; optionally enforce timeouts.',
    version: 1,
    schema: antiSpamConfig,
    permissions: [],
    intents: [
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    commands: [],
    pendingJobPolicy: 'cancel',
});

moduleRegistry.register({
    id: 'integrations',
    description:
        'Twitch, YouTube and public RSS/Atom notifications with a baseline and durable delivery.',
    version: 1,
    schema: integrationsConfig,
    permissions: [PermissionFlagsBits.SendMessages],
    intents: [],
    commands: ['feed'],
    pendingJobPolicy: 'cancel',
});

moduleRegistry.register({
    id: 'workflows',
    description:
        'Bounded join, provider and manual triggers with filtered, durable channel messages.',
    version: 1,
    schema: workflowsConfig,
    permissions: [PermissionFlagsBits.SendMessages],
    intents: [],
    commands: ['workflow'],
    pendingJobPolicy: 'cancel',
});

moduleRegistry.register({
    id: 'recovery',
    description:
        'Versioned snapshots, scheduled capture and owner-confirmed selective restore.',
    version: 1,
    schema: recoveryConfig,
    permissions: [],
    intents: [],
    commands: ['snapshot', 'restore'],
    pendingJobPolicy: 'cancel',
});

moduleRegistry.register({
    id: 'economy',
    description:
        'Opt-in fictional points, daily rewards, inventories and small games.',
    version: 1,
    schema: economyConfig,
    permissions: [],
    intents: [],
    commands: ['economy'],
    pendingJobPolicy: 'cancel',
});

moduleRegistry.register({
    id: 'entertainment',
    description:
        'Approved original image templates, private games and opt-in collection trades.',
    version: 1,
    schema: entertainmentConfig,
    permissions: [],
    intents: [],
    commands: ['fun', 'trade'],
    pendingJobPolicy: 'cancel',
});
