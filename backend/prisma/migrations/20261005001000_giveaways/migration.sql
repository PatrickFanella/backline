-- CreateTable
CREATE TABLE "Giveaway" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "prize" TEXT NOT NULL,
    "winnerCount" INTEGER NOT NULL,
    "requiredRoles" TEXT[],
    "minJoinedDays" INTEGER NOT NULL DEFAULT 0,
    "endsAt" TIMESTAMPTZ NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'CREATING',
    "messageId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Giveaway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiveawayEntry" (
    "giveawayId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiveawayEntry_pkey" PRIMARY KEY ("giveawayId","memberId")
);

-- CreateTable
CREATE TABLE "GiveawayDraw" (
    "id" TEXT NOT NULL,
    "giveawayId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "eligibleCount" INTEGER NOT NULL,
    "winners" TEXT[],
    "announcement" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiveawayDraw_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Giveaway_guildId_state_endsAt_idx" ON "Giveaway"("guildId", "state", "endsAt");

-- CreateIndex
CREATE INDEX "Giveaway_expiresAt_idx" ON "Giveaway"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Giveaway_guildId_requestId_key" ON "Giveaway"("guildId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "GiveawayDraw_giveawayId_round_key" ON "GiveawayDraw"("giveawayId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "GiveawayDraw_giveawayId_requestId_key" ON "GiveawayDraw"("giveawayId", "requestId");

-- AddForeignKey
ALTER TABLE "GiveawayEntry" ADD CONSTRAINT "GiveawayEntry_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayDraw" ADD CONSTRAINT "GiveawayDraw_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Giveaway" ADD CONSTRAINT "Giveaway_bounds" CHECK (
    "winnerCount" BETWEEN 1 AND 10 AND "minJoinedDays" BETWEEN 0 AND 365
    AND "expiresAt" > "endsAt"
    AND "state" IN ('CREATING', 'OPEN', 'DRAWN', 'CANCELLED', 'FAILED')
);
ALTER TABLE "GiveawayDraw" ADD CONSTRAINT "GiveawayDraw_bounds" CHECK (
    "round" BETWEEN 1 AND 11 AND "eligibleCount" >= 0
    AND "announcement" IN ('PENDING', 'DELIVERED')
);
