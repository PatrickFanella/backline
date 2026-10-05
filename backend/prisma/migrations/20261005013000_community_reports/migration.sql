-- CreateTable
CREATE TABLE "CommunityObservation" (
    "guildId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "channelId" TEXT,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "CommunityObservation_pkey" PRIMARY KEY ("guildId","eventId")
);

-- CreateTable
CREATE TABLE "CommunityCoverage" (
    "guildId" TEXT NOT NULL,
    "minute" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "CommunityCoverage_pkey" PRIMARY KEY ("guildId","minute")
);

-- CreateTable
CREATE TABLE "CommunityCohort" (
    "guildId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "joinedAt" TIMESTAMPTZ NOT NULL,
    "leftAt" TIMESTAMPTZ,

    CONSTRAINT "CommunityCohort_pkey" PRIMARY KEY ("guildId","memberId","joinedAt")
);

-- CreateTable
CREATE TABLE "CommunityCounter" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "lastAttemptAt" TIMESTAMPTZ NOT NULL,
    "expectedName" TEXT NOT NULL,

    CONSTRAINT "CommunityCounter_pkey" PRIMARY KEY ("guildId","channelId")
);

-- CreateIndex
CREATE INDEX "CommunityObservation_guildId_at_idx" ON "CommunityObservation"("guildId", "at");

-- CreateIndex
CREATE INDEX "CommunityCoverage_minute_idx" ON "CommunityCoverage"("minute");

-- CreateIndex
CREATE INDEX "CommunityCohort_guildId_joinedAt_idx" ON "CommunityCohort"("guildId", "joinedAt");

ALTER TABLE "CommunityObservation" ADD CONSTRAINT "CommunityObservation_kind" CHECK ("kind" IN ('messages', 'joins', 'departures'));
