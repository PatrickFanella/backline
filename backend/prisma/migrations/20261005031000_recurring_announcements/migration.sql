ALTER TABLE "ScheduledUtility" ADD COLUMN "seriesId" TEXT;
CREATE INDEX "ScheduledUtility_seriesId_idx" ON "ScheduledUtility"("seriesId");
CREATE TABLE "AnnouncementSeries" (
"id" TEXT NOT NULL PRIMARY KEY,"guildId" TEXT NOT NULL,"actorId" TEXT NOT NULL,"requestId" TEXT NOT NULL,
"channelId" TEXT NOT NULL,"content" TEXT NOT NULL CHECK(length("content") BETWEEN 0 AND 1800),
"timeZone" TEXT NOT NULL,"localTime" TEXT NOT NULL,"cadence" TEXT NOT NULL CHECK("cadence" IN ('daily','weekly')),
"ambiguity" TEXT NOT NULL CHECK("ambiguity" IN ('earlier','later')),"nextAt" TIMESTAMPTZ NOT NULL,
"endsAt" TIMESTAMPTZ NOT NULL,"state" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK("state" IN ('ACTIVE','CANCELLED','COMPLETED','HELD')),
"lastEventId" TEXT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "AnnouncementSeries_guildId_requestId_key" ON "AnnouncementSeries"("guildId","requestId");
CREATE INDEX "AnnouncementSeries_state_nextAt_idx" ON "AnnouncementSeries"("state","nextAt");
CREATE INDEX "AnnouncementSeries_guildId_createdAt_idx" ON "AnnouncementSeries"("guildId","createdAt");
