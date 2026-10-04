import { randomUUID } from 'crypto';

import { DurableJob, Prisma } from '@prisma/client';
import { z } from 'zod';

import { db } from '../db';
import { moduleRegistry } from '../modules/registry';
import { toInputJson } from '../utils/prismaJson';

const jobInput = z
    .object({
        guildId: z.string().regex(/^\d+$/),
        actorId: z.string().min(1),
        kind: z.string().min(1).max(100),
        moduleId: z.string().max(100).optional(),
        idempotencyKey: z.string().min(1).max(200),
        payload: z.json(),
        runAt: z.date(),
        expiresAt: z.date(),
        maxAttempts: z.number().int().min(1).max(10).default(5),
    })
    .refine(
        (value) => value.expiresAt > value.runAt,
        'Expiry must follow scheduled time'
    );

export async function enqueueJob(
    input: z.input<typeof jobInput>
): Promise<DurableJob> {
    const data = jobInput.parse(input);
    // An existing key keeps its original actor, payload and schedule.
    return db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${data.guildId})::bigint)::text`
        );
        const existing = await tx.durableJob.findUnique({
            where: {
                guildId_idempotencyKey: {
                    guildId: data.guildId,
                    idempotencyKey: data.idempotencyKey,
                },
            },
        });
        if (existing) return existing;
        const active = await tx.durableJob.count({
            where: {
                guildId: data.guildId,
                state: { in: ['PENDING', 'LEASED', 'RECONCILE'] },
            },
        });
        if (active >= 1000) throw new Error('Server action capacity reached');
        return tx.durableJob.create({
            data: { ...data, payload: toInputJson(data.payload) },
        });
    });
}

export async function claimJob(
    owner: string,
    leaseMs = 30000
): Promise<DurableJob | null> {
    if (!owner || leaseMs < 1000 || leaseMs > 300000)
        throw new Error('Invalid lease');
    return db.$transaction(async (tx) => {
        // A lost lease has an uncertain outcome. Never automatically replay a Discord mutation.
        const lost = await tx.durableJob.findMany({
            where: { state: 'LEASED', leaseUntil: { lte: new Date() } },
            take: 100,
        });
        for (const job of lost) {
            const changed = await tx.durableJob.updateMany({
                where: {
                    id: job.id,
                    state: 'LEASED',
                    leaseUntil: { lte: new Date() },
                },
                data: {
                    state: 'RECONCILE',
                    lastError: 'Worker lease expired',
                    leaseOwner: null,
                    leaseUntil: null,
                },
            });
            if (changed.count)
                await tx.jobAttempt.updateMany({
                    where: {
                        jobId: job.id,
                        number: job.attempts,
                        outcome: 'RUNNING',
                    },
                    data: {
                        outcome: 'UNCERTAIN',
                        detail: 'Worker lease expired',
                        finishedAt: new Date(),
                    },
                });
        }
        await tx.durableJob.updateMany({
            where: { state: 'PENDING', expiresAt: { lte: new Date() } },
            data: { state: 'CANCELLED', lastError: 'Job expired' },
        });
        const rows = await tx.$queryRaw<DurableJob[]>(Prisma.sql`
            SELECT * FROM "DurableJob" WHERE "state" = 'PENDING'
            AND "runAt" <= NOW() AND "expiresAt" > NOW() AND "attempts" < "maxAttempts"
            ORDER BY "runAt", "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
        `);
        if (!rows.length) return null;
        const job = await tx.durableJob.update({
            where: { id: rows[0].id },
            data: {
                state: 'LEASED',
                leaseOwner: owner,
                leaseUntil: new Date(Date.now() + leaseMs),
                attempts: { increment: 1 },
            },
        });
        await tx.jobAttempt.create({
            data: { jobId: job.id, number: job.attempts, owner },
        });
        return job;
    });
}

export type ActionOutcome =
    | { state: 'DELIVERED'; result: Prisma.InputJsonValue }
    | { state: 'RETRY'; reason: string }
    | { state: 'RECONCILE' | 'FAILED' | 'CANCELLED'; reason: string };

export async function finishJob(
    job: DurableJob,
    owner: string,
    outcome: ActionOutcome
): Promise<boolean> {
    return db.$transaction(async (tx) => {
        const retry = outcome.state === 'RETRY';
        const state = retry
            ? job.attempts < job.maxAttempts
                ? 'PENDING'
                : 'FAILED'
            : outcome.state;
        const result = await tx.durableJob.updateMany({
            where: {
                id: job.id,
                state: 'LEASED',
                leaseOwner: owner,
                attempts: job.attempts,
                leaseUntil: { gt: new Date() },
            },
            data: {
                state,
                leaseOwner: null,
                leaseUntil: null,
                lastError:
                    outcome.state === 'DELIVERED'
                        ? null
                        : outcome.reason.slice(0, 500),
                ...(outcome.state === 'DELIVERED'
                    ? { result: outcome.result }
                    : {}),
                ...(retry
                    ? {
                          runAt: new Date(
                              Date.now() +
                                  Math.min(300000, 1000 * 2 ** job.attempts)
                          ),
                      }
                    : {}),
            },
        });
        if (!result.count) return false;
        await tx.jobAttempt.update({
            where: { jobId_number: { jobId: job.id, number: job.attempts } },
            data: {
                outcome: outcome.state,
                detail:
                    outcome.state === 'DELIVERED'
                        ? null
                        : outcome.reason.slice(0, 500),
                finishedAt: new Date(),
            },
        });
        return true;
    });
}

export interface JobHandler {
    authorize(job: DurableJob): Promise<boolean>;
    execute(job: DurableJob): Promise<ActionOutcome>;
    reconcile(job: DurableJob): Promise<ActionOutcome>;
}

export class JobWorker {
    readonly owner = randomUUID();
    constructor(private handlers: Map<string, JobHandler>) {}
    async tick(): Promise<boolean> {
        const job = await claimJob(this.owner);
        if (!job) return false;
        if (
            job.moduleId &&
            !(await moduleRegistry.enabled(job.guildId, job.moduleId))
        ) {
            await finishJob(job, this.owner, {
                state: 'CANCELLED',
                reason: 'Module disabled',
            });
            return true;
        }
        const handler = this.handlers.get(job.kind);
        if (!handler) {
            await finishJob(job, this.owner, {
                state: 'FAILED',
                reason: 'Unknown action handler',
            });
            return true;
        }
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        try {
            if (!(await handler.authorize(job))) {
                await finishJob(job, this.owner, {
                    state: 'CANCELLED',
                    reason: 'Current server authorization denied',
                });
                return true;
            }
            const lease = await db.durableJob.findFirst({
                where: {
                    id: job.id,
                    leaseOwner: this.owner,
                    state: 'LEASED',
                    leaseUntil: { gt: new Date() },
                },
            });
            if (!lease) return true;
            heartbeat = setInterval(() => {
                void db.durableJob
                    .updateMany({
                        where: {
                            id: job.id,
                            leaseOwner: this.owner,
                            state: 'LEASED',
                            leaseUntil: { gt: new Date() },
                        },
                        data: { leaseUntil: new Date(Date.now() + 30000) },
                    })
                    .catch(() => console.warn('Job lease heartbeat failed'));
            }, 10000);
            await finishJob(job, this.owner, await handler.execute(job));
        } catch {
            await finishJob(job, this.owner, {
                state: 'RECONCILE',
                reason: 'Action outcome uncertain',
            });
        } finally {
            if (heartbeat) clearInterval(heartbeat);
        }
        return true;
    }
    async reconcile(jobId: string, guildId: string): Promise<boolean> {
        const job = await db.durableJob.findFirst({
            where: { id: jobId, guildId, state: 'RECONCILE' },
        });
        if (!job) return false;
        const handler = this.handlers.get(job.kind);
        if (!handler || !(await handler.authorize(job))) return false;
        const outcome = await handler.reconcile(job);
        // Reconciliation must prove delivery or prove no delivery; unresolved actions remain held.
        if (outcome.state !== 'DELIVERED' && outcome.state !== 'RETRY')
            return false;
        const updated = await db.durableJob.updateMany({
            where: { id: job.id, guildId, state: 'RECONCILE' },
            data:
                outcome.state === 'DELIVERED'
                    ? {
                          state: 'DELIVERED',
                          result: outcome.result,
                          lastError: null,
                      }
                    : {
                          state:
                              job.attempts < job.maxAttempts
                                  ? 'PENDING'
                                  : 'FAILED',
                          runAt: job.runAt,
                          lastError: 'Reconciled as not delivered',
                      },
        });
        return updated.count === 1;
    }
}
