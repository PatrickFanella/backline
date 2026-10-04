import axios from 'axios';
import { z } from 'zod';

import { db } from '../db';
import { env } from '../utils/env';

import { discordGuildSchema, syncGuildMemberships } from './installations';

const refreshSchema = z.object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1),
    expires_in: z.number().positive(),
    scope: z.string(),
});

export function canManageGuild(guild: {
    owner: boolean;
    permissions: string;
}): boolean {
    return (
        guild.owner || (BigInt(guild.permissions) & BigInt(40)) !== BigInt(0)
    );
}

// Share an in-flight refresh so rotated Discord refresh tokens are used once.
const pending = new Map<string, Promise<boolean>>();

async function refreshMemberships(userId: string): Promise<boolean> {
    try {
        const user = await db.user.findUnique({ where: { id: userId } });
        if (!user || user.role === 'BANNED' || !user.accessToken) return false;
        let token = user.accessToken;
        if (
            !user.accessTokenExpiresAt ||
            user.accessTokenExpiresAt <= new Date()
        ) {
            if (!user.refreshToken) return false;
            const response = await axios.post<unknown>(
                'https://discord.com/api/v10/oauth2/token',
                new URLSearchParams({
                    client_id: env.DISCORD_CLIENT_ID,
                    client_secret: env.DISCORD_CLIENT_SECRET,
                    grant_type: 'refresh_token',
                    refresh_token: user.refreshToken,
                }),
                { timeout: 5000 }
            );
            const refreshed = refreshSchema.parse(response.data);
            if (!refreshed.scope.split(' ').includes('guilds')) return false;
            token = refreshed.access_token;
            await db.user.update({
                where: { id: userId },
                data: {
                    accessToken: token,
                    refreshToken: refreshed.refresh_token,
                    accessTokenExpiresAt: new Date(
                        Date.now() + refreshed.expires_in * 1000
                    ),
                },
            });
        }
        const response = await axios.get<unknown>(
            'https://discord.com/api/v10/users/@me/guilds',
            { headers: { Authorization: `Bearer ${token}` }, timeout: 5000 }
        );
        await syncGuildMemberships(
            userId,
            z.array(discordGuildSchema).parse(response.data)
        );
        return true;
    } catch {
        // Axios errors can contain request credentials. Fail closed without logging them.
        return false;
    }
}

/** Recheck Discord membership and management permissions before each server operation. */
export async function authorizeGuild(
    userId: string,
    guildId: string
): Promise<boolean> {
    if (!/^\d+$/.test(guildId)) return false;
    if (env.BOT_GUILD_IDS.length && !env.BOT_GUILD_IDS.includes(guildId))
        return false;
    const installation = await db.guildInstallation.findUnique({
        where: { guildId },
    });
    if (!installation?.active) return false;
    if (!(await refreshCurrentMemberships(userId))) return false;
    const membership = await db.guild.findUnique({
        where: { userId_guildId: { userId, guildId } },
    });
    return (
        !!membership &&
        canManageGuild({
            owner: membership.owner,
            permissions: membership.permissions.toString(),
        })
    );
}

async function refreshCurrentMemberships(userId: string): Promise<boolean> {
    let refresh = pending.get(userId);
    if (!refresh) {
        refresh = refreshMemberships(userId);
        pending.set(userId, refresh);
    }
    let refreshed: boolean;
    try {
        refreshed = await refresh;
    } finally {
        if (pending.get(userId) === refresh) pending.delete(userId);
    }
    return refreshed;
}

export async function listManagedGuilds(userId: string) {
    if (!(await refreshCurrentMemberships(userId)))
        throw new Error('Discord authorization unavailable');
    const memberships = await db.guild.findMany({
        where: { userId, installation: { active: true } },
        orderBy: { name: 'asc' },
    });
    return memberships
        .filter(
            (member) =>
                (!env.BOT_GUILD_IDS.length ||
                    env.BOT_GUILD_IDS.includes(member.guildId)) &&
                canManageGuild({
                    owner: member.owner,
                    permissions: member.permissions.toString(),
                })
        )
        .map((member) => ({
            id: member.guildId,
            name: member.name,
            icon: member.icon,
        }));
}
