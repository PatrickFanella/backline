import { Guild, GuildMember, PermissionFlagsBits, Role } from 'discord.js';

export function assertAssignableRole(
    guild: Guild,
    bot: GuildMember,
    role: Role
): void {
    const allowed = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.UseVAD,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.UseExternalEmojis,
        PermissionFlagsBits.UseExternalStickers,
        PermissionFlagsBits.UseApplicationCommands,
        PermissionFlagsBits.Stream,
        PermissionFlagsBits.SendMessagesInThreads,
    ].reduce((mask, permission) => mask | permission, BigInt(0));
    if (
        role.guild.id !== guild.id ||
        role.id === guild.id ||
        role.managed ||
        (role.permissions.bitfield & ~allowed) !== BigInt(0) ||
        bot.roles.highest.comparePositionTo(role) <= 0 ||
        !bot.permissions.has(PermissionFlagsBits.ManageRoles)
    )
        throw new Error('Role is privileged, managed or above the bot');
}
