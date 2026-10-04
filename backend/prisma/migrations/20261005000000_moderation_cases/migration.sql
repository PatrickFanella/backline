CREATE TABLE "ModerationCase" (
 "id" TEXT NOT NULL PRIMARY KEY, "guildId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
 "actorId" TEXT NOT NULL, "targetId" TEXT, "channelId" TEXT, "action" TEXT NOT NULL,
 "reason" TEXT NOT NULL, "state" TEXT NOT NULL DEFAULT 'PENDING', "detail" TEXT,
 "outcome" JSONB, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "completedAt" TIMESTAMPTZ,
 CONSTRAINT "ModerationCase_state_check" CHECK ("state" IN ('PENDING','DELIVERED','DENIED','FAILED','UNCERTAIN'))
);
CREATE UNIQUE INDEX "ModerationCase_guildId_requestId_key" ON "ModerationCase"("guildId","requestId");
CREATE INDEX "ModerationCase_guildId_createdAt_idx" ON "ModerationCase"("guildId","createdAt");
CREATE INDEX "ModerationCase_guildId_targetId_idx" ON "ModerationCase"("guildId","targetId");
