CREATE TABLE "RolePanel" ("id" TEXT NOT NULL PRIMARY KEY,"guildId" TEXT NOT NULL,"configHash" TEXT NOT NULL,"channelId" TEXT NOT NULL,"messageId" TEXT,"state" TEXT NOT NULL DEFAULT 'PENDING',"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "RolePanel_guildId_configHash_key" ON "RolePanel"("guildId","configHash");
CREATE TABLE "RoleChoice" ("id" TEXT NOT NULL PRIMARY KEY,"guildId" TEXT NOT NULL,"userId" TEXT NOT NULL,"requestId" TEXT NOT NULL,"state" TEXT NOT NULL DEFAULT 'PENDING',"detail" TEXT,"outcome" JSONB,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "RoleChoice_guildId_requestId_key" ON "RoleChoice"("guildId","requestId");
CREATE INDEX "RoleChoice_guildId_userId_createdAt_idx" ON "RoleChoice"("guildId","userId","createdAt");
CREATE TABLE "RoleChoiceLock" ("guildId" TEXT NOT NULL,"userId" TEXT NOT NULL,"actionId" TEXT NOT NULL,PRIMARY KEY("guildId","userId"));
CREATE UNIQUE INDEX "RoleChoiceLock_actionId_key" ON "RoleChoiceLock"("actionId");
