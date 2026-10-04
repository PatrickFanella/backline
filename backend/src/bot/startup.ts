import path from 'path';

import { Client, GatewayIntentBits } from 'discord.js';

import { db } from '../db';
import { recordInstallation } from '../guilds/installations';
import { createBotWorker, startJobPolling } from '../jobs/botWorker';
import { moduleRegistry } from '../modules/registry';
import { pluginManager } from '../plugins';
import { PluginHookType } from '../plugins/types';
import { env } from '../utils/env';

import { registerCollectors } from './collectors';
import { registerGuildCommands, routeInteraction } from './commands';

export async function startBot(): Promise<Client> {
    const intents = [GatewayIntentBits.Guilds];
    if (env.BOT_ACTIVITY_INTENTS)
        intents.push(...moduleRegistry.get('activity').intents);
    const client = new Client({ intents });
    registerCollectors(client);
    client.on('interactionCreate', (interaction) => {
        void routeInteraction(interaction);
    });
    client.on('guildCreate', (guild) => {
        void recordInstallation(guild).catch(() =>
            console.warn('Installation recording failed')
        );
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
                await db.guildInstallation.updateMany({
                    where: { active: true, guildId: { notIn: guildIds } },
                    data: { active: false },
                });
                await Promise.all(
                    client.guilds.cache.map((guild) =>
                        recordInstallation(guild)
                    )
                );
                // Registration is explicit so a restart cannot overwrite an existing command deployment.
                if (env.BOT_REGISTER_COMMANDS)
                    await registerGuildCommands(
                        client,
                        guildIds.filter(
                            (id) =>
                                !env.BOT_GUILD_IDS.length ||
                                env.BOT_GUILD_IDS.includes(id)
                        )
                    );
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
                if (env.BOT_RUN_JOBS) {
                    const stop = startJobPolling(createBotWorker(client));
                    client.once('invalidated', () => {
                        void stop();
                    });
                    const destroy = client.destroy.bind(client);
                    client.destroy = async () => {
                        await stop();
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
        await client.destroy();
        throw error;
    }
}
