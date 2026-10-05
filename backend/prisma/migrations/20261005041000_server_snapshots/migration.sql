CREATE TABLE "ServerSnapshot" ("id" TEXT NOT NULL,"guildId" TEXT NOT NULL,"actorId" TEXT,"requestId" TEXT NOT NULL,"kind" TEXT NOT NULL DEFAULT 'MANUAL' CHECK("kind" IN ('MANUAL','SCHEDULED','TEMPLATE')),"manifest" JSONB NOT NULL,"checksum" TEXT NOT NULL,"expiresAt" TIMESTAMP(3) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "ServerSnapshot_pkey" PRIMARY KEY("id"));
CREATE UNIQUE INDEX "ServerSnapshot_guildId_requestId_key" ON "ServerSnapshot"("guildId","requestId");
CREATE INDEX "ServerSnapshot_guildId_createdAt_idx" ON "ServerSnapshot"("guildId","createdAt");
CREATE INDEX "ServerSnapshot_expiresAt_idx" ON "ServerSnapshot"("expiresAt");
