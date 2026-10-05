import { Client } from 'discord.js';

import { radioRuntime } from '../audio/radio';
import { antiSpamHandler, recoverSpamDecisions } from '../community/antiSpam';
import {
    auditHandler,
    expireAuditContent,
    recoverAuditEvents,
} from '../community/audit';
import { giveawayHandlers, recoverGiveaways } from '../community/giveaways';
import { expireLeveling, levelingHandler } from '../community/leveling';
import { onboardingHandler, recoverJourneys } from '../community/onboarding';
import { expireRoleChoices } from '../community/selfRoles';
import { expireTickets } from '../community/tickets';
import { db } from '../db';
import { authorizeGuild } from '../guilds/authorization';
import { performModeration } from '../moderation/service';
import { moduleRegistry } from '../modules/registry';

import { JobWorker, JobHandler } from './store';

export function createBotWorker(client: Client): JobWorker {
    return new JobWorker(
        new Map<string, JobHandler>([
            ...giveawayHandlers(client),
            ['level-reward', levelingHandler(client)],
            ['audit-log', auditHandler(client)],
            ['anti-spam', antiSpamHandler(client)],
            ['onboarding-join', onboardingHandler(client, 'join')],
            ['onboarding-departure', onboardingHandler(client, 'departure')],
            ['onboarding-roles', onboardingHandler(client, 'roles')],
            [
                'moderation',
                {
                    authorize: (job) =>
                        authorizeGuild(job.actorId, job.guildId),
                    execute: async (job) => {
                        const actor = await db.user.findUnique({
                            where: { id: job.actorId },
                        });
                        if (!actor)
                            return {
                                state: 'CANCELLED',
                                reason: 'Actor unavailable',
                            };
                        const record = await performModeration(
                            client,
                            job.guildId,
                            actor.discordId,
                            job.id,
                            job.payload
                        );
                        return record.state === 'DELIVERED'
                            ? {
                                  state: 'DELIVERED',
                                  result: {
                                      caseId: record.id,
                                      outcome: record.outcome,
                                  },
                              }
                            : {
                                  state:
                                      record.state === 'UNCERTAIN' ||
                                      record.state === 'PENDING'
                                          ? 'RECONCILE'
                                          : 'FAILED',
                                  reason:
                                      record.detail ?? 'Action not delivered',
                              };
                    },
                    reconcile: async (job) => {
                        const record = await db.moderationCase.findUnique({
                            where: {
                                guildId_requestId: {
                                    guildId: job.guildId,
                                    requestId: job.id,
                                },
                            },
                        });
                        return record?.state === 'DELIVERED'
                            ? {
                                  state: 'DELIVERED',
                                  result: {
                                      caseId: record.id,
                                      outcome: record.outcome,
                                  },
                              }
                            : {
                                  state: 'RECONCILE',
                                  reason: 'Manual outcome investigation required',
                              };
                    },
                },
            ],
            [
                'server-status',
                {
                    authorize: async (job) => {
                        if (
                            job.moduleId &&
                            !(await moduleRegistry.enabled(
                                job.guildId,
                                job.moduleId
                            ))
                        )
                            return false;
                        return authorizeGuild(job.actorId, job.guildId);
                    },
                    execute: async (job) => {
                        const guild = await client.guilds.fetch({
                            guild: job.guildId,
                            force: true,
                        });
                        const bot = await guild.members.fetchMe({
                            force: true,
                        });
                        return {
                            state: 'DELIVERED',
                            result: {
                                guildId: guild.id,
                                name: guild.name,
                                botPermissions:
                                    bot.permissions.bitfield.toString(),
                                gatewayReady: client.isReady(),
                            },
                        };
                    },
                    // This action only reads Discord. Repeating a read cannot duplicate a Discord mutation.
                    reconcile: () =>
                        Promise.resolve({
                            state: 'RETRY',
                            reason: 'Read-only action can be retried',
                        }),
                },
            ],
        ])
    );
}

export function startJobPolling(
    worker: JobWorker,
    client?: Client
): () => Promise<void> {
    let active: Promise<unknown> | undefined;
    let lastExpiry = 0;
    const interval = setInterval(() => {
        if (active) return;
        active = (async () => {
            if (Date.now() - lastExpiry > 60000) {
                await expireAuditContent();
                await recoverAuditEvents();
                await recoverJourneys();
                await expireRoleChoices();
                if (client) await expireTickets(client);
                await radioRuntime.expireHistory();
                await recoverSpamDecisions();
                await recoverGiveaways();
                await expireLeveling();
                lastExpiry = Date.now();
            }
            const held = await db.durableJob.findMany({
                where: {
                    state: 'RECONCILE',
                    kind: {
                        in: [
                            'server-status',
                            'giveaway-draw',
                            'giveaway-reroll',
                            'level-reward',
                        ],
                    },
                },
                take: 10,
            });
            for (const job of held) await worker.reconcile(job.id, job.guildId);
            return worker.tick();
        })()
            .catch(() => console.warn('Job polling failed'))
            .finally(() => {
                active = undefined;
            });
    }, 1000);
    return async () => {
        clearInterval(interval);
        await active;
    };
}
