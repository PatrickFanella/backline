CREATE TABLE "SpamSample" ("id" TEXT NOT NULL PRIMARY KEY,"guildId" TEXT NOT NULL,"eventId" TEXT NOT NULL,"userId" TEXT NOT NULL,"type" TEXT NOT NULL,"occurredAt" TIMESTAMPTZ NOT NULL);
CREATE UNIQUE INDEX "SpamSample_guildId_eventId_key" ON "SpamSample"("guildId","eventId");
CREATE INDEX "SpamSample_guildId_type_userId_occurredAt_idx" ON "SpamSample"("guildId","type","userId","occurredAt");
CREATE INDEX "SpamSample_occurredAt_idx" ON "SpamSample"("occurredAt");
CREATE TABLE "SpamDecision" ("id" TEXT NOT NULL PRIMARY KEY,"guildId" TEXT NOT NULL,"eventId" TEXT NOT NULL,"userId" TEXT NOT NULL,"reasons" JSONB NOT NULL,"policyHash" TEXT NOT NULL,"channelId" TEXT,"mode" TEXT NOT NULL,"state" TEXT NOT NULL DEFAULT 'OBSERVED',"jobId" TEXT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "SpamDecision_guildId_eventId_key" ON "SpamDecision"("guildId","eventId");
CREATE INDEX "SpamDecision_guildId_createdAt_idx" ON "SpamDecision"("guildId","createdAt");
CREATE TABLE "RaidState" ("guildId" TEXT NOT NULL PRIMARY KEY,"until" TIMESTAMPTZ NOT NULL);
