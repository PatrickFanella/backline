CREATE TABLE "ServerAuditEvent" (
 "id" TEXT NOT NULL PRIMARY KEY, "guildId" TEXT NOT NULL, "eventKey" TEXT NOT NULL,
 "kind" TEXT NOT NULL, "subjectId" TEXT, "channelId" TEXT, "data" JSONB NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'PENDING', "messageId" TEXT, "detail" TEXT,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMPTZ NOT NULL,
 CONSTRAINT "ServerAuditEvent_state_check" CHECK ("state" IN ('PENDING','SENDING','DELIVERED','FAILED','UNCERTAIN','SKIPPED'))
);
CREATE UNIQUE INDEX "ServerAuditEvent_guildId_eventKey_key" ON "ServerAuditEvent"("guildId","eventKey");
CREATE INDEX "ServerAuditEvent_guildId_createdAt_idx" ON "ServerAuditEvent"("guildId","createdAt");
CREATE INDEX "ServerAuditEvent_expiresAt_idx" ON "ServerAuditEvent"("expiresAt");
