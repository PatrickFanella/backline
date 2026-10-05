CREATE TABLE "ScheduledUtility" (
 "id" TEXT NOT NULL, "guildId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
 "requestId" TEXT NOT NULL, "kind" TEXT NOT NULL, "channelId" TEXT NOT NULL,
 "content" TEXT NOT NULL, "localTime" TEXT NOT NULL, "timeZone" TEXT NOT NULL,
 "runAt" TIMESTAMPTZ NOT NULL, "expiresAt" TIMESTAMPTZ NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'PENDING', "messageId" TEXT,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ScheduledUtility_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ScheduledUtility_kind_check" CHECK ("kind" IN ('REMINDER','ANNOUNCEMENT')),
 CONSTRAINT "ScheduledUtility_content_check" CHECK (length("content") BETWEEN 0 AND 1800)
);
CREATE UNIQUE INDEX "ScheduledUtility_guildId_requestId_key" ON "ScheduledUtility"("guildId", "requestId");
CREATE INDEX "ScheduledUtility_guildId_state_runAt_idx" ON "ScheduledUtility"("guildId", "state", "runAt");
CREATE INDEX "ScheduledUtility_expiresAt_idx" ON "ScheduledUtility"("expiresAt");
