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

async function fetchCurrentGuilds(token: string): Promise<unknown> {
    const fetch = () =>
        axios.get<unknown>('https://discord.com/api/v10/users/@me/guilds', {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 5000,
        });
    try {
        return (await fetch()).data;
    } catch (error) {
        if (
            !axios.isAxiosError<{ retry_after?: unknown }>(error) ||
            error.response?.status !== 429
        )
            throw error;
        const retryAfter = error.response.data?.retry_after;
        // Honor Discord's delay once; long or malformed limits remain unavailable.
        if (
            typeof retryAfter !== 'number' ||
            !Number.isFinite(retryAfter) ||
            retryAfter < 0 ||
            retryAfter > 5
        )
            throw error;
        await new Promise((resolve) =>
            setTimeout(resolve, Math.ceil(retryAfter * 1000) + 50)
        );
        return (await fetch()).data;
    }
}

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
        const guilds = await fetchCurrentGuilds(token);
        await syncGuildMemberships(
            userId,
            z.array(discordGuildSchema).parse(guilds)
        );
        return true;
    } catch (error) {
        // Provider errors contain credentials: log only transport classification.
        console.warn('Discord membership refresh failed', {
            type: error instanceof Error ? error.name : 'Unknown',
            code: axios.isAxiosError(error) ? error.code : undefined,
            status: axios.isAxiosError(error)
                ? error.response?.status
                : undefined,
        });
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
