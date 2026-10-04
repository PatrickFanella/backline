CREATE TABLE "SupportTicket" (
 "id" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL, "openerId" TEXT NOT NULL,
 "channelId" TEXT UNIQUE, "participants" JSONB NOT NULL, "staffRoles" JSONB NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'CREATING', "claimedBy" TEXT, "heldActionId" TEXT,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "closedAt" TIMESTAMPTZ, "expiresAt" TIMESTAMPTZ
);
CREATE INDEX "SupportTicket_guildId_openerId_state_idx" ON "SupportTicket" ("guildId","openerId","state");
CREATE INDEX "SupportTicket_expiresAt_idx" ON "SupportTicket" ("expiresAt");
CREATE TABLE "TicketAction" (
 "id" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL, "ticketId" TEXT NOT NULL,
 "requestId" TEXT NOT NULL, "actorId" TEXT NOT NULL, "kind" TEXT NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'PENDING', "detail" TEXT,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("guildId","requestId")
);
CREATE INDEX "TicketAction_ticketId_createdAt_idx" ON "TicketAction" ("ticketId","createdAt");
CREATE TABLE "TicketTranscript" (
 "ticketId" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL, "body" JSONB NOT NULL,
 "truncated" BOOLEAN NOT NULL, "containsContent" BOOLEAN NOT NULL DEFAULT false,
 "expiresAt" TIMESTAMPTZ NOT NULL
);
CREATE INDEX "TicketTranscript_expiresAt_idx" ON "TicketTranscript" ("expiresAt");
