import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';

import { db } from '../../../src/db';
import {
    claimJob,
    enqueueJob,
    finishJob,
    JobWorker,
} from '../../../src/jobs/store';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('durable PostgreSQL actions', () => {
    const guildId = '123456789';
    const ids: string[] = [];
    async function enqueue(
        maxAttempts = 5,
        runAt = new Date(Date.now() - 1000)
    ) {
        const job = await enqueueJob({
            guildId,
            actorId: 'fixture',
            kind: 'fixture',
            idempotencyKey: randomUUID(),
            payload: {},
            runAt,
            expiresAt: new Date(Date.now() + 3600000),
            maxAttempts,
        });
        ids.push(job.id);
        return job;
    }
    afterEach(async () => {
        await db.jobAttempt.deleteMany({ where: { jobId: { in: ids } } });
        await db.durableJob.deleteMany({ where: { id: { in: ids } } });
        ids.length = 0;
    });
    afterAll(async () => {
        await db.$disconnect();
    });
    it('preserves one scheduled action under concurrent enqueue with one key', async () => {
        const input = {
            guildId,
            actorId: 'fixture',
            kind: 'fixture',
            idempotencyKey: randomUUID(),
            payload: {},
            runAt: new Date(Date.now() + 60000),
            expiresAt: new Date(Date.now() + 3600000),
        };
        const jobs = await Promise.all(
            Array.from({ length: 4 }, () => enqueueJob(input))
        );
        ids.push(jobs[0].id);
        expect(new Set(jobs.map((job) => job.id)).size).toBe(1);
        expect(await claimJob('worker')).toBeNull();
    });
    it('gives only one of five competing workers the lease', async () => {
        const job = await enqueue();
        const claims = await Promise.all(
            Array.from({ length: 5 }, (_, number) =>
                claimJob(`worker-${number}`)
            )
        );
        expect(claims.filter(Boolean)).toHaveLength(1);
        expect(claims.find(Boolean)?.id).toBe(job.id);
        expect(await db.jobAttempt.count({ where: { jobId: job.id } })).toBe(1);
    });
    it('recovers pending actions in a new worker and records delivery', async () => {
        const job = await enqueue();
        const handler = {
            authorize: () => Promise.resolve(true),
            execute: () =>
                Promise.resolve({
                    state: 'DELIVERED' as const,
                    result: { providerId: 'fixture-delivery' },
                }),
            reconcile: () =>
                Promise.resolve({
                    state: 'RECONCILE' as const,
                    reason: 'unknown',
                }),
        };
        const worker = new JobWorker(new Map([['fixture', handler]]));
        expect(await worker.tick()).toBe(true);
        expect(
            (await db.durableJob.findUniqueOrThrow({ where: { id: job.id } }))
                .state
        ).toBe('DELIVERED');
        expect(await worker.tick()).toBe(false);
    });
    it('executes persisted work from a separate bot process', async () => {
        const job = await enqueue();
        const root = path.resolve(__dirname, '../../..');
        const script = `
            const {JobWorker} = require(${JSON.stringify(path.join(root, 'src/jobs/store.ts'))});
            const {db} = require(${JSON.stringify(path.join(root, 'src/db.ts'))});
            (async () => {
                const worker = new JobWorker(new Map([['fixture', {
                    authorize: () => Promise.resolve(true),
                    execute: () => Promise.resolve({state:'DELIVERED',result:{processId:process.pid}}),
                    reconcile: () => Promise.resolve({state:'RECONCILE',reason:'unknown'}),
                }]]));
                await worker.tick(); await db.$disconnect();
            })().catch(() => process.exit(1));
        `;
        const child = spawnSync(
            process.execPath,
            ['-r', 'ts-node/register', '-e', script],
            {
                cwd: root,
                env: {
                    ...process.env,
                    TS_NODE_PROJECT: path.join(root, 'tsconfig.json'),
                },
                timeout: 15000,
            }
        );
        expect(child.status).toBe(0);
        const result = await db.durableJob.findUniqueOrThrow({
            where: { id: job.id },
        });
        expect(result.state).toBe('DELIVERED');
        expect(result.result).not.toEqual({ processId: process.pid });
    });
    it('holds a lost lease for reconciliation and fences the stale owner', async () => {
        const job = await enqueue();
        const claimed = (await claimJob('old'))!;
        await db.durableJob.update({
            where: { id: job.id },
            data: { leaseUntil: new Date(0) },
        });
        expect(await claimJob('new')).toBeNull();
        expect(
            (await db.durableJob.findUniqueOrThrow({ where: { id: job.id } }))
                .state
        ).toBe('RECONCILE');
        expect(
            await finishJob(claimed, 'old', { state: 'DELIVERED', result: {} })
        ).toBe(false);
        const worker = new JobWorker(
            new Map([
                [
                    'fixture',
                    {
                        authorize: () => Promise.resolve(true),
                        execute: jest.fn(),
                        reconcile: () =>
                            Promise.resolve({
                                state: 'RETRY' as const,
                                reason: 'proven absent',
                            }),
                    },
                ],
            ])
        );
        expect(await worker.reconcile(job.id, '987654321')).toBe(false);
        expect(await worker.reconcile(job.id, guildId)).toBe(true);
        expect((await claimJob('new'))?.id).toBe(job.id);
    });
    it('bounds retries and retains failure history', async () => {
        const job = await enqueue(1);
        const claimed = (await claimJob('one'))!;
        await finishJob(claimed, 'one', {
            state: 'RETRY',
            reason: 'Known not delivered',
        });
        expect(
            (await db.durableJob.findUniqueOrThrow({ where: { id: job.id } }))
                .state
        ).toBe('FAILED');
        expect(
            (await db.jobAttempt.findFirstOrThrow({ where: { jobId: job.id } }))
                .outcome
        ).toBe('RETRY');
    });
    it('rechecks authorization before executing and cancels revoked actions', async () => {
        const job = await enqueue();
        const execute = jest.fn();
        const worker = new JobWorker(
            new Map([
                [
                    'fixture',
                    {
                        authorize: () => Promise.resolve(false),
                        execute,
                        reconcile: jest.fn(),
                    },
                ],
            ])
        );
        await worker.tick();
        expect(execute).not.toHaveBeenCalled();
        expect(
            (await db.durableJob.findUniqueOrThrow({ where: { id: job.id } }))
                .state
        ).toBe('CANCELLED');
    });
    it('preserves an uncertain external outcome rather than replaying it', async () => {
        const job = await enqueue();
        const worker = new JobWorker(
            new Map([
                [
                    'fixture',
                    {
                        authorize: () => Promise.resolve(true),
                        execute: () =>
                            Promise.reject(new Error('lost response')),
                        reconcile: () =>
                            Promise.resolve({
                                state: 'RECONCILE' as const,
                                reason: 'unknown',
                            }),
                    },
                ],
            ])
        );
        await worker.tick();
        expect(
            (await db.durableJob.findUniqueOrThrow({ where: { id: job.id } }))
                .state
        ).toBe('RECONCILE');
        expect(await worker.tick()).toBe(false);
        expect(await worker.reconcile(job.id, guildId)).toBe(false);
    });
});
