import path from 'path';

import { Client, Partials } from 'discord.js';

import { radioRuntime } from '../audio/radio';
import { registerAntiSpamEvents } from '../community/antiSpam';
import { registerAuditEvents } from '../community/audit';
import { registerLevelingEvents } from '../community/leveling';
import { registerMemberUtilityEvents } from '../community/memberUtilities';
import { registerOnboardingEvents } from '../community/onboarding';
import { registerCommunityReportEvents } from '../community/reports';
import { applySelfRoleReaction } from '../community/selfRoles';
import { db } from '../db';
import { recordInstallation } from '../guilds/installations';
import { createBotWorker, startJobPolling } from '../jobs/botWorker';
import { configuredIntents, moduleRegistry } from '../modules/registry';
import { pluginManager } from '../plugins';
import { PluginHookType } from '../plugins/types';
import { env } from '../utils/env';
import { registerWorkflowEvents } from '../workflows/engine';

import { registerCollectors } from './collectors';
import { registerGuildCommands, routeInteraction } from './commands';

export async function startBot(): Promise<Client> {
    const client = new Client({
        intents: configuredIntents(),
        partials: [
            Partials.Message,
            Partials.Channel,
            Partials.GuildMember,
            Partials.Reaction,
            Partials.User,
        ],
    });
    client.on('messageReactionAdd', (reaction, user) => {
        void applySelfRoleReaction(client, reaction, user, true).catch(() =>
            console.warn('Reaction role assignment failed')
        );
    });
    client.on('messageReactionRemove', (reaction, user) => {
        void applySelfRoleReaction(client, reaction, user, false).catch(() =>
            console.warn('Reaction role removal failed')
        );
    });
    registerAuditEvents(client);
    registerWorkflowEvents(client);
    registerMemberUtilityEvents(client);
    registerAntiSpamEvents(client);
    registerOnboardingEvents(client);
    registerCollectors(client);
    const stopLeveling = registerLevelingEvents(client);
    const stopReports = registerCommunityReportEvents(client);
    client.on('interactionCreate', (interaction) => {
        void routeInteraction(interaction);
    });
    client.on('guildCreate', (guild) => {
        // Initial Gateway discovery is handled once by clientReady.
        if (!client.isReady()) return;
        void (async () => {
            await recordInstallation(guild);
            if (
                !env.BOT_GUILD_IDS.length ||
                env.BOT_GUILD_IDS.includes(guild.id)
            )
                await registerGuildCommands(client, [guild.id]);
        })().catch(() => console.warn('Installation provisioning failed'));
    });
    client.on('guildDelete', (guild) => {
        void recordInstallation(guild, false).catch(() =>
            console.warn('Installation removal recording failed')
        );
    });
    const ready = new Promise<void>((resolve, reject) => {
        client.once('clientReady', () => {
            void (async () => {
                const guildIds = client.guilds.cache.map((guild) => guild.id);
                const known = await db.guildInstallation.findMany({
                    where: { active: true },
                });
                for (const missing of known.filter(
                    (row) => !guildIds.includes(row.guildId)
                ))
                    await recordInstallation(
                        {
                            id: missing.guildId,
                            name: missing.name,
                            icon: missing.icon,
                        },
                        false
                    );
                await Promise.all(
                    client.guilds.cache.map((guild) =>
                        recordInstallation(guild)
                    )
                );
                const needsCommands = guildIds.filter(
                    (id) =>
                        (env.BOT_REGISTER_COMMANDS ||
                            !known.some((row) => row.guildId === id)) &&
                        (!env.BOT_GUILD_IDS.length ||
                            env.BOT_GUILD_IDS.includes(id))
                );
                if (needsCommands.length)
                    await registerGuildCommands(client, needsCommands);
                await pluginManager.initialize(
                    {
                        pluginDir: path.join(__dirname, '../../plugins'),
                        dataDir: path.join(__dirname, '../../plugin-data'),
                        autoStart: true,
                    },
                    client
                );
                for (const id of guildIds)
                    await moduleRegistry.dispatch(id, 'operator-plugins', () =>
                        pluginManager.executeDiscordHook(
                            PluginHookType.DISCORD_READY,
                            { guildId: id, client }
                        )
                    );
                console.log('Bot ready');
                if (env.BOT_VOICE_INTENT) await radioRuntime.recover(guildIds);
                if (env.BOT_RUN_JOBS) {
                    const stop = startJobPolling(
                        createBotWorker(client),
                        client
                    );
                    client.once('invalidated', () => {
                        void stop();
                    });
                    const destroy = client.destroy.bind(client);
                    client.destroy = async () => {
                        await stopLeveling();
                        await stopReports();
                        await radioRuntime.shutdown();
                        await stop();
                        await destroy();
                    };
                }
                if (!env.BOT_RUN_JOBS) {
                    const destroy = client.destroy.bind(client);
                    client.destroy = async () => {
                        await stopLeveling();
                        await stopReports();
                        await radioRuntime.shutdown();
                        await destroy();
                    };
                }
                resolve();
            })().catch(reject);
        });
    });
    client.on('presenceUpdate', (oldPresence, newPresence) => {
        const id = newPresence.guild?.id;
        if (!id) return;
        void moduleRegistry.dispatch(id, 'operator-plugins', () =>
            pluginManager.executeDiscordHook(
                PluginHookType.DISCORD_PRESENCE_UPDATE,
                { guildId: id, oldPresence, newPresence }
            )
        );
    });
    client.on('messageCreate', (message) => {
        if (message.guildId)
            void moduleRegistry.dispatch(
                message.guildId,
                'operator-plugins',
                () =>
                    pluginManager.executeDiscordHook(
                        PluginHookType.DISCORD_MESSAGE_CREATE,
                        message
                    )
            );
    });
    client.on('guildMemberAdd', (member) => {
        void moduleRegistry.dispatch(member.guild.id, 'operator-plugins', () =>
            pluginManager.executeDiscordHook(
                PluginHookType.DISCORD_GUILD_MEMBER_ADD,
                member
            )
        );
    });
    client.on('guildMemberRemove', (member) => {
        void moduleRegistry.dispatch(member.guild.id, 'operator-plugins', () =>
            pluginManager.executeDiscordHook(
                PluginHookType.DISCORD_GUILD_MEMBER_REMOVE,
                member
            )
        );
    });
    client.on('error', () => console.warn('Discord client error'));
    client.on('shardError', () => console.warn('Discord Gateway error'));
    try {
        await client.login(env.DISCORD_BOT_TOKEN);
        await ready;
        return client;
    } catch (error) {
        await stopLeveling();
        await stopReports();
        await client.destroy();
        throw error;
    }
}
