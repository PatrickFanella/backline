import { GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { z } from 'zod';

import { db } from '../db';
import { env } from '../utils/env';
import { toInputJson } from '../utils/prismaJson';

export interface ModuleDefinition {
    id: string;
    description: string;
    version: number;
    schema: z.ZodType;
    permissions: bigint[];
    intents: GatewayIntentBits[];
    commands: string[];
    pendingJobPolicy: 'cancel' | 'pause';
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
        config: unknown
    ): Promise<void> {
        const definition = this.get(moduleId);
        if (env.BOT_GUILD_IDS.length && !env.BOT_GUILD_IDS.includes(guildId))
            throw new Error('Server excluded by operator');
        if (enabled && moduleId === 'activity' && !env.BOT_ACTIVITY_INTENTS)
            throw new Error('Activity Gateway intents unavailable');
        const validated = toInputJson(definition.schema.parse(config));
        const installation = await db.guildInstallation.findUnique({
            where: { guildId },
        });
        if (!installation?.active)
            throw new Error('Bot installation unavailable');
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
    id: 'activity',
    description: 'Observed member activity and existing analytics collectors',
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
    description: 'Trusted operator-installed Discord plugin hooks',
    version: 1,
    schema: z.object({}).strict(),
    permissions: [],
    intents: [],
    commands: [],
    pendingJobPolicy: 'cancel',
});
