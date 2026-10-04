import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { db } from '../db';

import { actionPermissions, performModeration } from './service';

export const moderationCommands = Object.entries(actionPermissions).map(
    ([action, permission]) => {
        const command = new SlashCommandBuilder()
            .setName(action)
            .setDescription(`${action} with a recorded moderation case`)
            .setDefaultMemberPermissions(permission)
            .setContexts(0)
            .setIntegrationTypes(0)
            .addStringOption((option) =>
                option
                    .setName('reason')
                    .setDescription('Reason recorded in case history')
                    .setRequired(true)
                    .setMaxLength(400)
            );
        if (action === 'purge')
            command.addIntegerOption((option) =>
                option
                    .setName('count')
                    .setDescription(
                        'Recent messages to consider; pinned and older messages are skipped'
                    )
                    .setRequired(true)
                    .setMinValue(1)
                    .setMaxValue(100)
            );
        else if (action === 'unban')
            command.addStringOption((option) =>
                option
                    .setName('target')
                    .setDescription('Banned Discord user ID')
                    .setRequired(true)
            );
        else
            command.addUserOption((option) =>
                option
                    .setName('target')
                    .setDescription('Member to moderate')
                    .setRequired(true)
            );
        if (action === 'timeout')
            command.addIntegerOption((option) =>
                option
                    .setName('minutes')
                    .setDescription('Timeout duration')
                    .setRequired(true)
                    .setMinValue(1)
                    .setMaxValue(40320)
            );
        return command.toJSON();
    }
);
moderationCommands.push(
    new SlashCommandBuilder()
        .setName('cases')
        .setDescription('Show recent moderation cases')
        .setDefaultMemberPermissions(actionPermissions.warn)
        .setContexts(0)
        .setIntegrationTypes(0)
        .toJSON()
);
export async function routeModeration(
    interaction: ChatInputCommandInteraction
): Promise<boolean> {
    if (interaction.commandName === 'cases') {
        const member = await interaction.guild!.members.fetch({
            user: interaction.user.id,
            force: true,
        });
        if (!member.permissions.has(actionPermissions.warn)) {
            await interaction.editReply(
                'Current Moderate Members permission is required.'
            );
            return true;
        }
        const cases = await db.moderationCase.findMany({
            where: { guildId: interaction.guildId! },
            orderBy: { createdAt: 'desc' },
            take: 10,
        });
        await interaction.editReply({
            content: cases.length
                ? cases
                      .map(
                          (record) =>
                              `${record.id}: ${record.action} ${record.targetId ?? record.channelId} — ${record.state}`
                      )
                      .join('\n')
                : 'No moderation cases recorded.',
            allowedMentions: { parse: [] },
        });
        return true;
    }
    if (
        !Object.prototype.hasOwnProperty.call(
            actionPermissions,
            interaction.commandName
        )
    )
        return false;
    const record = await performModeration(
        interaction.client,
        interaction.guildId!,
        interaction.user.id,
        interaction.id,
        {
            action: interaction.commandName,
            reason: interaction.options.getString('reason', true),
            ...(interaction.commandName === 'purge'
                ? {
                      channelId: interaction.channelId,
                      count: interaction.options.getInteger('count', true),
                  }
                : {
                      targetId:
                          interaction.commandName === 'unban'
                              ? interaction.options.getString('target', true)
                              : interaction.options.getUser('target', true).id,
                  }),
            ...(interaction.commandName === 'timeout'
                ? { minutes: interaction.options.getInteger('minutes', true) }
                : {}),
        }
    );
    await interaction.editReply({
        content: `Case ${record.id}: ${record.state}${record.detail ? ` — ${record.detail}` : ''}${record.action === 'warn' && record.state === 'DELIVERED' ? ' — warning recorded; no DM sent' : ''}`,
        allowedMentions: { parse: [] },
    });
    return true;
}
