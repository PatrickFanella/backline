CREATE TABLE "VoicePlayback" (
 "id" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL, "channelId" TEXT NOT NULL,
 "requesterId" TEXT NOT NULL, "stationId" TEXT NOT NULL, "state" TEXT NOT NULL DEFAULT 'STARTING',
 "detail" TEXT, "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "finishedAt" TIMESTAMPTZ, "playbackMs" INTEGER NOT NULL DEFAULT 0, "daveProtocol" INTEGER
);
CREATE INDEX "VoicePlayback_guildId_startedAt_idx" ON "VoicePlayback" ("guildId","startedAt");
CREATE UNIQUE INDEX "VoicePlayback_one_active_guild" ON "VoicePlayback" ("guildId") WHERE "state" IN ('STARTING','PLAYING');
