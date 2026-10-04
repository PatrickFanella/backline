import { Client, ClientEvents } from 'discord.js';

import { db } from '../db';
import { moduleRegistry } from '../modules/registry';
import { cacheInvalidation } from '../services/cacheInvalidation';
import { sanitizeForLog } from '../utils/security';

export function registerCollectors(client: Client): void {
    function on<K extends keyof ClientEvents>(
        event: K,
        guildId: (args: ClientEvents[K]) => string | undefined,
        handler: (...args: ClientEvents[K]) => Promise<void>
    ): void {
        client.on(event, (...args) => {
            const id = guildId(args);
            if (id)
                void moduleRegistry.dispatch(id, 'activity', () =>
                    handler(...args)
                );
        });
    }
    on(
        'presenceUpdate',
        (args) => args[1].guild?.id,
        async (oldPresence, newPresence) => {
            const user = newPresence?.user;
            const clientStatus = newPresence?.clientStatus;
            const guildId = newPresence?.guild?.id;

            if (!user || !clientStatus || !guildId) return;

            const platforms = Object.keys(clientStatus); // desktop, mobile, web

            if (platforms.length > 1) {
                console.log(
                    `[⚠️ MULTI-CLIENT] ${sanitizeForLog(user.username)} is online on: ${platforms
                        .map(sanitizeForLog)
                        .join(', ')}`
                );
                await db.presenceEvent.create({
                    data: {
                        userId: user.id,
                        username: user.username,
                        clients: platforms,
                        guildId,
                    },
                });

                // Emit WebSocket event for multi-client detection
                const { websocketService } = await import(
                    '../services/websocket'
                );
                websocketService.emitMultiClientAlert(guildId, {
                    userId: user.id,
                    username: user.username,
                    platforms,
                    timestamp: new Date(),
                });
            }
        }
    );

    on(
        'typingStart',
        (args) => args[0].guild?.id,
        async (typing) => {
            const { user, channel, guild } = typing;
            if (!user || !channel || !guild || user.bot) return;

            if (!channel.isTextBased()) return;

            // Get the most recent message in this channel from a different user
            const lastMsg = await db.messageEvent.findFirst({
                where: {
                    channelId: channel.id,
                    guildId: guild.id,
                    NOT: {
                        userId: user.id, // ignore if same user
                    },
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });

            if (!lastMsg) return;

            const deltaMs = Date.now() - new Date(lastMsg.createdAt).getTime();

            if (deltaMs < 5000) {
                console.log(
                    `[⏱️ DB CORRELATED] ${sanitizeForLog(user.username)} started typing ${deltaMs}ms after ${sanitizeForLog(
                        lastMsg.username
                    )} in #${sanitizeForLog('name' in channel ? channel.name : 'unknown')}`
                );

                // Save for long-term analysis
                await db.reactionTime.create({
                    data: {
                        observerId: user.id,
                        observerName: user.username ?? user.id,
                        actorId: lastMsg.userId,
                        actorName: lastMsg.username,
                        channelId: channel.id,
                        guildId: guild.id,
                        deltaMs,
                    },
                });
            }
        }
    );

    on(
        'messageCreate',
        (args) => args[0].guildId ?? undefined,
        async (message) => {
            // Ignore bots and DMs
            if (message.author.bot || !message.guild) return;

            const channelName =
                'name' in message.channel && message.channel.name
                    ? message.channel.name
                    : 'unknown';

            await db.messageEvent.create({
                data: {
                    userId: message.author.id,
                    username: message.author.username ?? message.author.id,
                    channelId: message.channel.id,
                    channel: channelName,
                    guildId: message.guild.id,
                    content: message.content.slice(0, 1000), // limit content length for now
                },
            });

            // Invalidate analytics caches after message creation
            await cacheInvalidation.onMessageCreated(message.guild.id);

            // Emit WebSocket event for new message
            const { websocketService } = await import('../services/websocket');
            websocketService.emitNewMessage(message.guild.id, {
                userId: message.author.id,
                username: message.author.username ?? message.author.id,
                channelId: message.channel.id,
                channelName,
                timestamp: new Date(),
            });

            // Broadcast throttled analytics update
            const { analyticsBroadcaster } = await import(
                '../services/analyticsBroadcaster'
            );
            analyticsBroadcaster.broadcastAnalyticsUpdate(message.guild.id);

            console.log(
                `[💬 MESSAGE] ${sanitizeForLog(message.author.username)} in #${sanitizeForLog(channelName)}: ${sanitizeForLog(message.content)}`
            );
        }
    );

    on(
        'guildMemberAdd',
        (args) => args[0].guild.id,
        async (member) => {
            const accountCreated = member.user.createdAt.getTime();
            const now = Date.now();
            const accountAgeDays = Math.floor(
                (now - accountCreated) / (1000 * 60 * 60 * 24)
            );

            await db.joinEvent.create({
                data: {
                    userId: member.user.id,
                    username: member.user.username ?? member.user.id,
                    guildId: member.guild.id,
                    accountAgeDays,
                },
            });

            // Emit WebSocket event for user join
            const { websocketService } = await import('../services/websocket');
            websocketService.emitUserJoin(member.guild.id, {
                userId: member.user.id,
                username: member.user.username ?? member.user.id,
                accountAgeDays,
                timestamp: new Date(),
            });

            console.log(
                `[🟢 JOIN] ${sanitizeForLog(member.user.username)} (account age: ${accountAgeDays} days) joined ${sanitizeForLog(member.guild.name)}`
            );
        }
    );

    on(
        'messageDelete',
        (args) => args[0].guildId ?? undefined,
        async (message) => {
            if (!message.guild || message.author?.bot) return;

            const channelName =
                'name' in message.channel ? message.channel.name : 'unknown';

            await db.deletedMessageEvent.create({
                data: {
                    userId: message.author?.id ?? 'unknown',
                    username: message.author?.username ?? 'unknown',
                    channelId: message.channel.id,
                    channel: channelName,
                    guildId: message.guild.id,
                    createdAt: new Date(),
                },
            });
        }
    );

    on(
        'guildMemberUpdate',
        (args) => args[1].guild.id,
        async (oldMember, newMember) => {
            const oldRoleIds = new Set(oldMember.roles.cache.map((r) => r.id));
            const newRoleIds = new Set(newMember.roles.cache.map((r) => r.id));

            const added = [...newRoleIds].filter((r) => !oldRoleIds.has(r));
            if (added.length === 0) return;

            const addedRoleNames = added
                .map((rid) => newMember.guild.roles.cache.get(rid)?.name)
                .filter(Boolean) as string[];

            await db.roleChangeEvent.create({
                data: {
                    userId: newMember.id,
                    username: newMember.user.username ?? newMember.id,
                    guildId: newMember.guild.id,
                    addedRoles: addedRoleNames,
                },
            });

            // Emit WebSocket event for role change
            const { websocketService } = await import('../services/websocket');
            websocketService.emitRoleChange(newMember.guild.id, {
                userId: newMember.id,
                username: newMember.user.username ?? newMember.id,
                addedRoles: addedRoleNames,
                timestamp: new Date(),
            });

            console.log(
                `[🕵️ ROLE DRIFT] ${sanitizeForLog(newMember.user.username)} gained roles: ${sanitizeForLog(addedRoleNames)}`
            );
        }
    );
}
