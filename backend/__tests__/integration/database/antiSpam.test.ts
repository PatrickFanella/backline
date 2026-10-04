import { randomUUID } from 'crypto';

import {
    contentReasons,
    inspectSpam,
    recoverSpamDecisions,
    SpamEvent,
} from '../../../src/community/antiSpam';
import { antiSpamConfig } from '../../../src/community/config';
import { db } from '../../../src/db';
import { moduleRegistry } from '../../../src/modules/registry';
import { env } from '../../../src/utils/env';

const databaseTests =
    process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
describe('bounded content matching', () => {
    const config = antiSpamConfig.parse({
        prohibitedWords: ['blocked text'],
        prohibitedDomains: ['blocked.example'],
    });
    it('matches configured text, domains and mention floods', () => {
        expect(
            contentReasons(
                config,
                'BLOCKED TEXT https://sub.blocked.example/path',
                5
            )
        ).toEqual(['mention-flood', 'prohibited-word', 'prohibited-link']);
    });
    it('does not treat a domain-prefix lookalike as the configured domain', () => {
        expect(
            contentReasons(
                config,
                'https://blocked.example.attacker.example/',
                0
            )
        ).toEqual([]);
    });
    it('starts in observation with bounded limits', () => {
        expect(antiSpamConfig.parse({}).observeOnly).toBe(true);
        expect(antiSpamConfig.safeParse({ windowSeconds: 301 }).success).toBe(
            false
        );
    });
});
databaseTests('persistent spam decisions', () => {
    const guildId = '333333333333333334',
        userId = '333333333333333335';
    function event(input: Partial<SpamEvent> = {}): SpamEvent {
        return {
            guildId,
            userId,
            eventId: randomUUID(),
            type: 'message',
            occurredAt: new Date(),
            content: 'ordinary message',
            mentions: 0,
            roleIds: [],
            exempt: false,
            ...input,
        };
    }
    beforeEach(async () => {
        env.BOT_GUILD_IDS.push(guildId);
        env.BOT_MEMBER_INTENTS = true;
        env.BOT_MESSAGE_INTENTS = true;
        env.BOT_MESSAGE_CONTENT_INTENT = true;
        await db.guildInstallation.upsert({
            where: { guildId },
            create: { guildId, name: 'fixture', active: true },
            update: { active: true },
        });
        await moduleRegistry.configure(guildId, 'anti-spam', true, {
            messageLimit: 3,
        });
    });
    afterEach(async () => {
        env.BOT_GUILD_IDS.splice(env.BOT_GUILD_IDS.indexOf(guildId), 1);
        env.BOT_MEMBER_INTENTS = false;
        env.BOT_MESSAGE_INTENTS = false;
        env.BOT_MESSAGE_CONTENT_INTENT = false;
        const jobs = await db.durableJob.findMany({
            where: { guildId },
            select: { id: true },
        });
        await db.jobAttempt.deleteMany({
            where: { jobId: { in: jobs.map((job) => job.id) } },
        });
        await db.durableJob.deleteMany({ where: { guildId } });
        await db.spamDecision.deleteMany({ where: { guildId } });
        await db.spamSample.deleteMany({ where: { guildId } });
        await db.raidState.deleteMany({ where: { guildId } });
        await db.guildModuleConfig.deleteMany({ where: { guildId } });
        await db.guildInstallation.delete({ where: { guildId } });
    });
    afterAll(async () => {
        await db.$disconnect();
    });
    it('detects a concurrent burst once per event without enforcing in observation', async () => {
        await Promise.all(
            Array.from({ length: 3 }, () => inspectSpam(event()))
        );
        const decisions = await db.spamDecision.findMany({
            where: { guildId },
        });
        expect(decisions).toHaveLength(1);
        expect(decisions[0].mode).toBe('OBSERVE');
        expect(decisions[0].state).toBe('OBSERVED');
        expect(await db.durableJob.count({ where: { guildId } })).toBe(0);
    });
    it('deduplicates replayed events and isolates users', async () => {
        const input = event({ mentions: 6 });
        await Promise.all(Array.from({ length: 3 }, () => inspectSpam(input)));
        await inspectSpam(event({ userId: 'other' }));
        expect(await db.spamDecision.count({ where: { guildId } })).toBe(1);
        expect(await db.spamSample.count({ where: { guildId } })).toBe(2);
    });
    it('honors role, channel and manager exemptions before sampling', async () => {
        await moduleRegistry.configure(guildId, 'anti-spam', true, {
            exemptRoles: ['444444444444444444'],
            exemptChannels: ['555555555555555555'],
        });
        await inspectSpam(
            event({ roleIds: ['444444444444444444'], mentions: 100 })
        );
        await inspectSpam(
            event({ channelId: '555555555555555555', mentions: 100 })
        );
        await inspectSpam(event({ exempt: true, mentions: 100 }));
        expect(await db.spamSample.count({ where: { guildId } })).toBe(0);
        expect(await db.spamDecision.count({ where: { guildId } })).toBe(0);
    });
    it('persists join burst raid mode across handler instances', async () => {
        await moduleRegistry.configure(guildId, 'anti-spam', true, {
            joinLimit: 2,
        });
        await inspectSpam(event({ type: 'join', userId: 'first' }));
        await inspectSpam(event({ type: 'join', userId: 'second' }));
        expect(
            (
                await db.raidState.findUniqueOrThrow({ where: { guildId } })
            ).until.getTime()
        ).toBeGreaterThan(Date.now());
        await inspectSpam(event({ type: 'join', userId: 'third' }));
        expect(await db.spamDecision.count({ where: { guildId } })).toBe(2);
    });
    it('queues one enforcement action and cancels interrupted capture when policy changes', async () => {
        await moduleRegistry.configure(guildId, 'anti-spam', true, {
            observeOnly: false,
        });
        await inspectSpam(event({ mentions: 6 }));
        const decision = await db.spamDecision.findFirstOrThrow({
            where: { guildId },
        });
        expect(decision.jobId).not.toBeNull();
        expect(await db.durableJob.count({ where: { guildId } })).toBe(1);
        await db.spamDecision.update({
            where: { id: decision.id },
            data: { jobId: null },
        });
        await moduleRegistry.configure(guildId, 'anti-spam', true, {
            observeOnly: true,
        });
        await recoverSpamDecisions();
        expect(
            (
                await db.spamDecision.findUniqueOrThrow({
                    where: { id: decision.id },
                })
            ).state
        ).toBe('CANCELLED');
    });
});
