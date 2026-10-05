import { Interaction, SlashCommandBuilder } from 'discord.js';
import { z } from 'zod';

import { db } from '../db';

import { clipSelect } from './clips';
import { enqueueSoundboard } from './queue';
import { audioAccess, radioRuntime } from './radio';

export const clipCommand = new SlashCommandBuilder()
    .setName('clip')
    .setDescription('Play manager-approved short audio and soundboards')
    .setContexts(0)
    .setIntegrationTypes(0)
    .addSubcommand((s) =>
        s
            .setName('search')
            .setDescription('Search this server approved clips')
            .addStringOption((o) =>
                o.setName('query').setDescription('Title text').setMaxLength(60)
            )
    )
    .addSubcommand((s) =>
        s
            .setName('play')
            .setDescription('Play an approved clip in your voice channel')
            .addStringOption((o) =>
                o.setName('id').setDescription('Clip ID').setRequired(true)
            )
    )
    .addSubcommand((s) =>
        s.setName('boards').setDescription('List this server soundboards')
    )
    .addSubcommand((s) =>
        s
            .setName('queue-board')
            .setDescription('DJ: append a soundboard without starting it')
            .addStringOption((o) =>
                o
                    .setName('name')
                    .setDescription('Board name')
                    .setRequired(true)
                    .setMaxLength(40)
            )
    )
    .toJSON();
export async function routeClips(interaction: Interaction) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'clip')
        return false;
    const guildId = interaction.guildId!,
        actorId = interaction.user.id,
        sub = interaction.options.getSubcommand();
    try {
        const access = await audioAccess(interaction.client, guildId, actorId);
        if (!access.config.clipsEnabled) throw new Error('Clips disabled');
        if (sub === 'play') {
            const id = z
                .string()
                .uuid()
                .parse(interaction.options.getString('id', true));
            await radioRuntime.play(
                interaction.client,
                guildId,
                actorId,
                undefined,
                undefined,
                1,
                id
            );
            await interaction.editReply(
                'Approved clip playback started. /audio stop or /audio skip interrupts it.'
            );
        } else if (sub === 'queue-board') {
            await enqueueSoundboard(
                interaction.client,
                guildId,
                actorId,
                interaction.options.getString('name', true)
            );
            await interaction.editReply(
                'Soundboard queued. A DJ explicitly starts it with /audio start.'
            );
        } else if (sub === 'boards') {
            const boards = await db.audioSoundboard.findMany({
                where: { guildId },
                orderBy: { name: 'asc' },
                take: 20,
            });
            await interaction.editReply(
                boards.map((b) => b.name).join('\n') || 'No soundboards.'
            );
        } else {
            const rows = await db.audioClip.findMany({
                where: {
                    guildId,
                    title: {
                        contains: interaction.options.getString('query') ?? '',
                        mode: 'insensitive',
                    },
                },
                select: clipSelect,
                orderBy: { title: 'asc' },
                take: 15,
            });
            await interaction.editReply(
                rows
                    .map((r) => `${r.id}: ${r.title} · ${r.durationMs} ms`)
                    .join('\n') || 'No matching approved clips.'
            );
        }
    } catch {
        await interaction.editReply(
            'Clip action unavailable. Check clip approval, voice membership, current permissions and audio settings.'
        );
    }
    return true;
}
