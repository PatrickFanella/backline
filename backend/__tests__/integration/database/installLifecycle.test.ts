import { db } from '../../../src/db';
import { recordInstallation } from '../../../src/guilds/installations';
import { claimJob, enqueueJob } from '../../../src/jobs/store';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
databaseTests('installation removal and reinstall', () => {
    const guild = { id: '123456780', name: 'Lifecycle fixture', icon: null };
    afterEach(async () => {
        const jobs = await db.durableJob.findMany({
            where: { guildId: guild.id },
            select: { id: true },
        });
        await db.jobAttempt.deleteMany({
            where: { jobId: { in: jobs.map((job) => job.id) } },
        });
        await db.durableJob.deleteMany({ where: { guildId: guild.id } });
        await db.guildModuleConfig.deleteMany({ where: { guildId: guild.id } });
        await db.guildInstallation.deleteMany({ where: { guildId: guild.id } });
    });
    afterAll(async () => {
        await db.$disconnect();
    });
    it('disables modules and cancels pending work while preserving configuration for reinstall', async () => {
        await recordInstallation(guild);
        await db.guildModuleConfig.create({
            data: {
                guildId: guild.id,
                moduleId: 'fixture',
                enabled: true,
                config: { channelId: 'saved' },
            },
        });
        const job = await enqueueJob({
            guildId: guild.id,
            actorId: 'fixture',
            kind: 'fixture',
            payload: {},
            idempotencyKey: 'pending',
            runAt: new Date(Date.now() + 60000),
            expiresAt: new Date(Date.now() + 3600000),
        });
        await recordInstallation(guild, false);
        expect(
            (await db.durableJob.findUniqueOrThrow({ where: { id: job.id } }))
                .state
        ).toBe('CANCELLED');
        await recordInstallation(guild);
        const config = await db.guildModuleConfig.findFirstOrThrow({
            where: { guildId: guild.id },
        });
        expect(config.enabled).toBe(false);
        expect(config.config).toEqual({ channelId: 'saved' });
        expect(
            (
                await db.guildInstallation.findUniqueOrThrow({
                    where: { guildId: guild.id },
                })
            ).active
        ).toBe(true);
    });
    it('holds an in-flight action and records uncertainty on uninstall', async () => {
        await recordInstallation(guild);
        const job = await enqueueJob({
            guildId: guild.id,
            actorId: 'fixture',
            kind: 'fixture',
            payload: {},
            idempotencyKey: 'leased',
            runAt: new Date(Date.now() - 1000),
            expiresAt: new Date(Date.now() + 3600000),
        });
        await claimJob('owner');
        await recordInstallation(guild, false);
        expect(
            (await db.durableJob.findUniqueOrThrow({ where: { id: job.id } }))
                .state
        ).toBe('RECONCILE');
        expect(
            (await db.jobAttempt.findFirstOrThrow({ where: { jobId: job.id } }))
                .outcome
        ).toBe('UNCERTAIN');
    });
});
