import { Guild, GuildMember, PermissionFlagsBits, Role } from 'discord.js';

export class RoleAssignmentError extends Error {}

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
        (role.permissions.bitfield & ~allowed) !== BigInt(0)
    )
        throw new RoleAssignmentError(
            'This role is privileged or managed and cannot be offered for self-service. Choose a basic interest role.'
        );
    if (!bot.permissions.has(PermissionFlagsBits.ManageRoles))
        throw new RoleAssignmentError(
            'Backline needs Manage Roles permission to offer self-service roles.'
        );
    if (bot.roles.highest.comparePositionTo(role) <= 0)
        throw new RoleAssignmentError(
            'Move the Backline role above the offered roles in Server Settings → Roles, then try again. Administrator permission does not bypass Discord’s role hierarchy.'
        );
}
