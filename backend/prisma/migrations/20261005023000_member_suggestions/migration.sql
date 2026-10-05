CREATE TABLE "CommunitySuggestion" (
"id" TEXT NOT NULL PRIMARY KEY, "guildId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
"requestId" TEXT NOT NULL, "channelId" TEXT NOT NULL, "content" TEXT NOT NULL,
"state" TEXT NOT NULL DEFAULT 'OPEN', "decision" TEXT, "reviewerId" TEXT,
"deliveryState" TEXT NOT NULL DEFAULT 'PENDING', "messageId" TEXT,
"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "CommunitySuggestion_state_check" CHECK ("state" IN ('OPEN','ACCEPTED','DECLINED')),
CONSTRAINT "CommunitySuggestion_content_check" CHECK (length("content") BETWEEN 1 AND 1200));
CREATE UNIQUE INDEX "CommunitySuggestion_guildId_requestId_key" ON "CommunitySuggestion"("guildId","requestId");
CREATE INDEX "CommunitySuggestion_guildId_createdAt_idx" ON "CommunitySuggestion"("guildId","createdAt");
CREATE TABLE "SuggestionVote" (
"suggestionId" TEXT NOT NULL REFERENCES "CommunitySuggestion"("id") ON DELETE CASCADE,
"memberId" TEXT NOT NULL, "value" INTEGER NOT NULL CHECK ("value" IN (-1,1)),
PRIMARY KEY ("suggestionId","memberId"));
