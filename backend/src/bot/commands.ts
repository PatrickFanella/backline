import {
    ChatInputCommandInteraction,
    Client,
    Interaction,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';

import { acknowledgeRules } from '../community/onboarding';
import { db } from '../db';
import { moderationCommands, routeModeration } from '../moderation/commands';
import { moduleRegistry } from '../modules/registry';

export const coreCommands = [
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show available commands'),
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Show server setup and permission diagnostics')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Show bot and server module status'),
    new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Configure server modules')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption((option) =>
            option
                .setName('module')
                .setDescription('Module to configure')
                .setRequired(true)
                .addChoices(
                    ...moduleRegistry.list().map((module) => ({
                        name: module.id,
                        value: module.id,
                    }))
                )
        )
        .addBooleanOption((option) =>
            option
                .setName('enabled')
                .setDescription('Enable or disable the module')
                .setRequired(true)
        ),
].map((command) => command.setContexts(0).setIntegrationTypes(0).toJSON());

async function currentManager(
    interaction: ChatInputCommandInteraction
): Promise<boolean> {
    if (!interaction.guild) return false;
    const member = await interaction.guild.members.fetch({
        user: interaction.user.id,
        force: true,
    });
    return (
        interaction.guild.ownerId === member.id ||
        member.permissions.has(PermissionFlagsBits.Administrator) ||
        member.permissions.has(PermissionFlagsBits.ManageGuild)
    );
}

export async function routeInteraction(
    interaction: Interaction
): Promise<void> {
    if (!interaction.isRepliable()) return;
    try {
        if (!interaction.inGuild() || !interaction.guild) {
            await interaction.reply({
                content:
                    'Use this command in a server where the bot is installed.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const installation = await db.guildInstallation.findUnique({
            where: { guildId: interaction.guildId },
        });
        if (!installation?.active) {
            await interaction.editReply(
                'This server installation is unavailable.'
            );
            return;
        }
        if (await acknowledgeRules(interaction)) return;
        if (!interaction.isChatInputCommand()) {
            await interaction.editReply(
                'This control is unknown or expired. Open a new panel with the relevant command.'
            );
            return;
        }
        if (await routeModeration(interaction)) return;
        switch (interaction.commandName) {
            case 'help':
                await interaction.editReply(
                    '/help — commands\n/setup — server diagnostics\n/settings module enabled — configure a module\n/status — current module status\n/warn /timeout /kick /ban /unban /purge /cases — opt-in moderation\nSettings require current Manage Server permission. Activity collection is opt-in.'
                );
                break;
            case 'setup': {
                if (!(await currentManager(interaction))) {
                    await interaction.editReply(
                        'Current Manage Server permission is required.'
                    );
                    return;
                }
                const bot = await interaction.guild.members.fetchMe({
                    force: true,
                });
                const diagnostics = moduleRegistry.list().map((module) => {
                    const permissions = module.permissions.filter(
                        (permission) => !bot.permissions.has(permission)
                    );
                    const intents = module.intents.filter(
                        (intent) =>
                            !interaction.client.options.intents.has(intent)
                    );
                    return `${module.id}: ${permissions.length} missing bot permissions; ${intents.length} missing Gateway intents${intents.length ? ' (operator must enable activity intents and restart)' : ''}`;
                });
                await interaction.editReply(
                    `Server setup is ready. Use /settings to opt into modules.\n${diagnostics.join('\n')}`
                );
                break;
            }
            case 'settings': {
                if (!(await currentManager(interaction))) {
                    await interaction.editReply(
                        'Current Manage Server permission is required.'
                    );
                    return;
                }
                const moduleId = interaction.options.getString('module', true);
                const enabled = interaction.options.getBoolean('enabled', true);
                const module = moduleRegistry.get(moduleId);
                if (
                    enabled &&
                    module.intents.some(
                        (intent) =>
                            !interaction.client.options.intents.has(intent)
                    )
                ) {
                    await interaction.editReply(
                        'The bot is missing required Gateway intents. Ask the operator to enable them and restart before enabling this module.'
                    );
                    return;
                }
                const bot = await interaction.guild.members.fetchMe({
                    force: true,
                });
                if (
                    enabled &&
                    module.permissions.some(
                        (permission) => !bot.permissions.has(permission)
                    )
                ) {
                    await interaction.editReply(
                        'The bot is missing required server permissions. Check /setup.'
                    );
                    return;
                }
                await moduleRegistry.configure(
                    interaction.guildId,
                    moduleId,
                    enabled,
                    (
                        await db.guildModuleConfig.findUnique({
                            where: {
                                guildId_moduleId: {
                                    guildId: interaction.guildId,
                                    moduleId,
                                },
                            },
                        })
                    )?.config ?? {}
                );
                await interaction.editReply(
                    `${moduleId} ${enabled ? 'enabled' : 'disabled'} for this server.`
                );
                break;
            }
            case 'status': {
                const settings = await db.guildModuleConfig.findMany({
                    where: { guildId: interaction.guildId },
                });
                await interaction.editReply(
                    `Bot connected. Server: ${interaction.guildId}\n${moduleRegistry
                        .list()
                        .map(
                            (module) =>
                                `${module.id}: ${settings.find((row) => row.moduleId === module.id)?.enabled ? 'enabled' : 'disabled'}`
                        )
                        .join('\n')}`
                );
                break;
            }
            default:
                await interaction.editReply('Unknown command. Use /help.');
        }
    } catch {
        console.warn('Interaction failed');
        try {
            if (interaction.deferred || interaction.replied)
                await interaction.editReply(
                    'The action failed. Check /status and try again.'
                );
            else
                await interaction.reply({
                    content: 'The action failed. Please try again.',
                    flags: MessageFlags.Ephemeral,
                });
        } catch {
            console.warn('Interaction response unavailable');
        }
    }
}

export async function registerGuildCommands(
    client: Client,
    guildIds: string[]
): Promise<void> {
    for (const guildId of guildIds) {
        const guild = await client.guilds.fetch(guildId);
        for (const command of [...coreCommands, ...moderationCommands])
            await guild.commands.create(command);
    }
}
