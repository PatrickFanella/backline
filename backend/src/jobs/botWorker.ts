import { Client } from 'discord.js';

import { db } from '../db';
import { authorizeGuild } from '../guilds/authorization';
import { moduleRegistry } from '../modules/registry';

import { JobWorker } from './store';

export function createBotWorker(client: Client): JobWorker {
    return new JobWorker(
        new Map([
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

export function startJobPolling(worker: JobWorker): () => Promise<void> {
    let active: Promise<unknown> | undefined;
    const interval = setInterval(() => {
        if (active) return;
        active = (async () => {
            const held = await db.durableJob.findMany({
                where: { state: 'RECONCILE', kind: 'server-status' },
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
