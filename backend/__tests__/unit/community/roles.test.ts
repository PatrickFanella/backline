import { Guild, GuildMember, PermissionFlagsBits, Role } from 'discord.js';

import {
    assertAssignableRole,
    RoleAssignmentError,
} from '../../../src/community/roles';

function fixtures(position = 1, permissions = BigInt(0)) {
    const guild = { id: 'guild' } as Guild;
    const bot = {
        roles: { highest: { comparePositionTo: () => position } },
        permissions: { has: () => true },
    } as unknown as GuildMember;
    const role = {
        id: 'interest',
        guild,
        managed: false,
        permissions: { bitfield: permissions },
    } as Role;
    return { guild, bot, role };
}
it('explains the role hierarchy even when the bot has Administrator', () => {
    const { guild, bot, role } = fixtures(-1);
    expect(() => assertAssignableRole(guild, bot, role)).toThrow(
        RoleAssignmentError
    );
    expect(() => assertAssignableRole(guild, bot, role)).toThrow(
        'Move the Backline role above'
    );
});
it('still rejects privileged roles below the bot', () => {
    const { guild, bot, role } = fixtures(1, PermissionFlagsBits.Administrator);
    expect(() => assertAssignableRole(guild, bot, role)).toThrow(
        'privileged or managed'
    );
});
it('allows an unprivileged interest role below the bot', () => {
    const { guild, bot, role } = fixtures();
    expect(() => assertAssignableRole(guild, bot, role)).not.toThrow();
});
