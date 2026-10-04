CREATE TABLE "MemberJourney" (
 "id" TEXT NOT NULL PRIMARY KEY, "guildId" TEXT NOT NULL, "userId" TEXT NOT NULL,
 "joinedAt" TEXT NOT NULL, "username" TEXT NOT NULL, "state" TEXT NOT NULL DEFAULT 'PENDING',
 "welcomeMessageId" TEXT, "welcomeChannelId" TEXT, "rulesHash" TEXT, "rolesState" TEXT NOT NULL DEFAULT 'PENDING',
 "acknowledgedAt" TIMESTAMPTZ, "leftAt" TIMESTAMPTZ, "departureState" TEXT NOT NULL DEFAULT 'PENDING',
 "departureMessageId" TEXT, "detail" TEXT, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX "MemberJourney_guildId_userId_joinedAt_key" ON "MemberJourney"("guildId","userId","joinedAt");
CREATE INDEX "MemberJourney_guildId_userId_createdAt_idx" ON "MemberJourney"("guildId","userId","createdAt");
CREATE INDEX "MemberJourney_expiresAt_idx" ON "MemberJourney"("expiresAt");
