-- CreateTable
CREATE TABLE "LevelProfile" (
    "guildId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "digestKey" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMPTZ,
    "lastVoiceAt" TIMESTAMPTZ,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LevelProfile_pkey" PRIMARY KEY ("guildId","memberId")
);

-- CreateTable
CREATE TABLE "LevelGrant" (
    "guildId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LevelGrant_pkey" PRIMARY KEY ("guildId","requestId")
);

-- CreateTable
CREATE TABLE "LevelDigest" (
    "guildId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "LevelDigest_pkey" PRIMARY KEY ("guildId","memberId","digest")
);

-- CreateIndex
CREATE INDEX "LevelProfile_guildId_xp_idx" ON "LevelProfile"("guildId", "xp" DESC);

-- CreateIndex
CREATE INDEX "LevelProfile_updatedAt_idx" ON "LevelProfile"("updatedAt");

-- CreateIndex
CREATE INDEX "LevelGrant_guildId_memberId_createdAt_idx" ON "LevelGrant"("guildId", "memberId", "createdAt");

-- CreateIndex
CREATE INDEX "LevelGrant_createdAt_idx" ON "LevelGrant"("createdAt");

-- CreateIndex
CREATE INDEX "LevelDigest_expiresAt_idx" ON "LevelDigest"("expiresAt");

ALTER TABLE "LevelProfile" ADD CONSTRAINT "LevelProfile_nonnegative_xp" CHECK ("xp" BETWEEN 0 AND 2000000000);
ALTER TABLE "LevelGrant" ADD CONSTRAINT "LevelGrant_bounds" CHECK ("amount" BETWEEN 1 AND 100 AND "source" IN ('MESSAGE', 'VOICE'));
