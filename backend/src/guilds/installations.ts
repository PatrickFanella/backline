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
    await db.$transaction(async (tx) => {
        await tx.guildInstallation.upsert({
            where: { guildId: guild.id },
            create: {
                guildId: guild.id,
                name: guild.name,
                icon: guild.icon,
                active,
            },
            update: { name: guild.name, icon: guild.icon, active },
        });
        if (!active) {
            await tx.guildModuleConfig.updateMany({
                where: { guildId: guild.id },
                data: { enabled: false },
            });
            await tx.durableJob.updateMany({
                where: { guildId: guild.id, state: 'PENDING' },
                data: { state: 'CANCELLED', lastError: 'Bot uninstalled' },
            });
            const leased = await tx.durableJob.findMany({
                where: { guildId: guild.id, state: 'LEASED' },
            });
            for (const job of leased) {
                await tx.durableJob.updateMany({
                    where: { id: job.id, state: 'LEASED' },
                    data: {
                        state: 'RECONCILE',
                        lastError: 'Bot uninstalled during delivery',
                        leaseOwner: null,
                        leaseUntil: null,
                    },
                });
                await tx.jobAttempt.updateMany({
                    where: {
                        jobId: job.id,
                        number: job.attempts,
                        outcome: 'RUNNING',
                    },
                    data: {
                        outcome: 'UNCERTAIN',
                        detail: 'Bot uninstalled during delivery',
                        finishedAt: new Date(),
                    },
                });
            }
        }
    });
}
