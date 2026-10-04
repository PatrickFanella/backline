import { z } from 'zod';

import { db } from '../db';

export const discordGuildSchema = z.object({
    id: z.string().regex(/^\d+$/),
    name: z.string(),
    icon: z.string().nullable(),
    owner: z.boolean(),
    permissions: z.string().regex(/^\d+$/),
});

/** Replace one user's memberships atomically without overwriting other administrators. */
export async function syncGuildMemberships(
    userId: string,
    payload: unknown
): Promise<void> {
    const guilds = z.array(discordGuildSchema).parse(payload);
    await db.$transaction(async (tx) => {
        await tx.guild.deleteMany({
            where: {
                userId,
                guildId: { notIn: guilds.map((guild) => guild.id) },
            },
        });
        for (const guild of guilds) {
            await tx.guildInstallation.upsert({
                where: { guildId: guild.id },
                create: {
                    guildId: guild.id,
                    name: guild.name,
                    icon: guild.icon,
                },
                update: { name: guild.name, icon: guild.icon },
            });
            const data = {
                name: guild.name,
                icon: guild.icon,
                owner: guild.owner,
                permissions: BigInt(guild.permissions),
                syncedAt: new Date(),
            };
            await tx.guild.upsert({
                where: { userId_guildId: { userId, guildId: guild.id } },
                create: { ...data, userId, guildId: guild.id },
                update: data,
            });
        }
    });
}

export async function recordInstallation(
    guild: { id: string; name: string; icon: string | null },
    active = true
): Promise<void> {
    await db.guildInstallation.upsert({
        where: { guildId: guild.id },
        create: {
            guildId: guild.id,
            name: guild.name,
            icon: guild.icon,
            active,
        },
        update: { name: guild.name, icon: guild.icon, active },
    });
}
