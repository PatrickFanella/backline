import { Interaction, SlashCommandBuilder } from 'discord.js';

import { db } from '../db';
import { moduleRegistry } from '../modules/registry';

import { customCommandsConfig, renderCustomResponse } from './utilityTemplates';

export const customCommand = new SlashCommandBuilder()
    .setName('custom')
    .setDescription('Use a configured server command')
    .setContexts(0)
    .setIntegrationTypes(0)
    .addStringOption((option) =>
        option
            .setName('name')
            .setDescription(
                'Configured command name; omit to list your available commands'
            )
    )
    .toJSON();
export async function routeCustomCommands(
    interaction: Interaction
): Promise<boolean> {
    if (
        !interaction.isChatInputCommand() ||
        interaction.commandName !== 'custom'
    )
        return false;
    if (
        !interaction.guild ||
        !(await moduleRegistry.enabled(interaction.guild.id, 'custom-commands'))
    ) {
        await interaction.editReply(
            'Custom commands are disabled for this server.'
        );
        return true;
    }
    const member = await interaction.guild.members.fetch({
        user: interaction.user.id,
        force: true,
    });
    const account = await db.user.findUnique({
        where: { discordId: member.id },
        select: { role: true },
    });
    if (member.user.bot || account?.role === 'BANNED') {
        await interaction.editReply(
            'Custom commands are unavailable for this account.'
        );
        return true;
    }
    const saved = await db.guildModuleConfig.findUniqueOrThrow({
        where: {
            guildId_moduleId: {
                guildId: interaction.guild.id,
                moduleId: 'custom-commands',
            },
        },
    });
    if (
        !saved.enabled ||
        !(await moduleRegistry.enabled(interaction.guild.id, 'custom-commands'))
    ) {
        await interaction.editReply(
            'Custom commands are disabled for this server.'
        );
        return true;
    }
    const commands = customCommandsConfig
        .parse(saved.config)
        .commands.filter(
            (command) =>
                !command.requiredRoles.length ||
                command.requiredRoles.some((role) =>
                    member.roles.cache.has(role)
                )
        );
    const name = interaction.options.getString('name');
    if (!name) {
        await interaction.editReply(
            commands.length
                ? `Available custom commands: ${commands.map((command) => command.name).join(', ')}`
                : 'No custom commands are available to you.'
        );
        return true;
    }
    const command = commands.find((row) => row.name === name);
    if (!command) {
        await interaction.editReply(
            'This custom command is unavailable or requires a configured role.'
        );
        return true;
    }
    await interaction.editReply(
        renderCustomResponse(command.response, {
            user: member.displayName,
            server: interaction.guild.name,
            channel:
                interaction.channel && 'name' in interaction.channel
                    ? (interaction.channel.name ?? 'this channel')
                    : 'this channel',
        })
    );
    return true;
}
