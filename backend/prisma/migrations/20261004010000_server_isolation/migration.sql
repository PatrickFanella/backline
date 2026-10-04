-- DropIndex
DROP INDEX "Guild_guildId_key";

-- AlterTable
ALTER TABLE "PresenceEvent" ADD COLUMN     "guildId" TEXT;

-- AlterTable
ALTER TABLE "Guild" ADD COLUMN     "syncedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "GuildInstallation" (
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "installedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "GuildInstallation_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "GuildModuleConfig" (
    "guildId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "GuildModuleConfig_pkey" PRIMARY KEY ("guildId","moduleId")
);

-- CreateIndex
CREATE INDEX "PresenceEvent_guildId_createdAt_idx" ON "PresenceEvent"("guildId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Guild_guildId_idx" ON "Guild"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "Guild_userId_guildId_key" ON "Guild"("userId", "guildId");

-- AddForeignKey
-- Preserve existing memberships before introducing the installation relation.
-- Installation presence is confirmed by the bot; OAuth membership alone does not activate it.
INSERT INTO "GuildInstallation" ("guildId", "name", "icon", "updatedAt")
SELECT "guildId", "name", "icon", CURRENT_TIMESTAMP FROM "Guild"
ON CONFLICT ("guildId") DO NOTHING;

ALTER TABLE "Guild" ADD CONSTRAINT "Guild_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildInstallation"("guildId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildModuleConfig" ADD CONSTRAINT "GuildModuleConfig_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildInstallation"("guildId") ON DELETE RESTRICT ON UPDATE CASCADE;
