import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { db } from '../db';

import { audioConfig } from './config';
import { validateWave } from './wave';

export const clipMetadata = z
    .object({
        title: z.string().trim().min(1).max(60),
        source: z.string().trim().min(1).max(400),
        license: z.string().trim().min(1).max(200),
        rights: z.enum(['original', 'licensed']),
        confirmed: z.literal(true),
    })
    .strict();
export const clipSelect = {
    id: true,
    title: true,
    byteSize: true,
    durationMs: true,
    source: true,
    license: true,
    rights: true,
    approvedBy: true,
    createdAt: true,
    lastUsedAt: true,
} as const;
export const boardSchema = z
    .object({
        name: z
            .string()
            .trim()
            .regex(/^[\p{L}\p{N} _-]{1,40}$/u),
        clipIds: z
            .array(z.string().uuid())
            .min(1)
            .max(20)
            .refine((ids) => new Set(ids).size === ids.length),
    })
    .strict();
async function clipSettings(
    tx: Prisma.TransactionClient,
    guildId: string,
    playback = false
) {
    const installation = await tx.guildInstallation.findUnique({
            where: { guildId },
        }),
        settings = await tx.guildModuleConfig.findUnique({
            where: { guildId_moduleId: { guildId, moduleId: 'audio' } },
        });
    if (
        !installation?.active ||
        !settings ||
        settings.version !== 1 ||
        !audioConfig.parse(settings.config).clipsEnabled ||
        (playback && !settings.enabled)
    )
        throw new Error('Approved clips disabled');
}
export async function storeClip(
    guildId: string,
    actorId: string,
    data: Buffer,
    raw: unknown
) {
    const metadata = clipMetadata.parse(raw),
        validated = validateWave(data),
        sha256 = createHash('sha256').update(data).digest('hex');
    return db.$transaction(
        async (tx) => {
            await tx.$queryRaw(
                Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
            );
            await clipSettings(tx, guildId);
            const prior = await tx.audioClip.findUnique({
                where: { guildId_sha256: { guildId, sha256 } },
                select: clipSelect,
            });
            if (prior) return prior;
            const quota = await tx.audioClip.aggregate({
                where: { guildId },
                _count: true,
                _sum: { byteSize: true },
            });
            if (
                quota._count >= 100 ||
                (quota._sum.byteSize ?? 0) + data.length > 50 * 1024 * 1024
            )
                throw new Error('Server clip quota reached');
            return tx.audioClip.create({
                data: {
                    guildId,
                    approvedBy: actorId,
                    data: new Uint8Array(data),
                    sha256,
                    durationMs: validated.durationMs,
                    byteSize: validated.byteSize,
                    title: metadata.title,
                    source: metadata.source,
                    license: metadata.license,
                    rights: metadata.rights,
                },
                select: clipSelect,
            });
        },
        { maxWait: 10000, timeout: 10000 }
    );
}
export async function approvedClip(guildId: string, id: string) {
    z.string().uuid().parse(id);
    return db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
        );
        await clipSettings(tx, guildId, true);
        const clip = await tx.audioClip.findFirstOrThrow({
            where: { guildId, id },
        });
        validateWave(Buffer.from(clip.data));
        await tx.audioClip.update({
            where: { id },
            data: { lastUsedAt: new Date() },
        });
        return clip;
    });
}
export async function saveSoundboard(
    guildId: string,
    actorId: string,
    raw: unknown
) {
    const input = boardSchema.parse(raw);
    return db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
        );
        await clipSettings(tx, guildId);
        if (
            (await tx.audioClip.count({
                where: { guildId, id: { in: input.clipIds } },
            })) !== input.clipIds.length
        )
            throw new Error('All clips must belong to this server');
        const key = { guildId, name: input.name };
        if (
            !(await tx.audioSoundboard.findUnique({
                where: { guildId_name: key },
            })) &&
            (await tx.audioSoundboard.count({ where: { guildId } })) >= 20
        )
            throw new Error('Twenty soundboards per server');
        return tx.audioSoundboard.upsert({
            where: { guildId_name: key },
            create: { ...key, clipIds: input.clipIds, updatedBy: actorId },
            update: { clipIds: input.clipIds, updatedBy: actorId },
        });
    });
}
export async function deleteClip(guildId: string, id: string) {
    z.string().uuid().parse(id);
    return db.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${guildId})::bigint)::text`
        );
        // Withdraw approval and binary bytes even when playback has been disabled.
        return tx.audioClip.deleteMany({ where: { guildId, id } });
    });
}
export async function expireClips(now = new Date()) {
    const before = new Date(now.getTime() - 90 * 86400000);
    await db.$executeRaw`DELETE FROM "AudioClip" WHERE "id" IN (SELECT "id" FROM "AudioClip" WHERE "lastUsedAt" < ${before} OR ("lastUsedAt" IS NULL AND "createdAt" < ${before}) ORDER BY "createdAt" LIMIT 100)`;
}
