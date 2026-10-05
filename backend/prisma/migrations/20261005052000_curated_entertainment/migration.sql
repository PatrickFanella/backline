ALTER TABLE "EconomyAccount" ADD COLUMN "lastCollectionAt" TIMESTAMP(3);
CREATE TABLE "EntertainmentReceipt" ("id" TEXT NOT NULL,"guildId" TEXT NOT NULL,"memberId" TEXT NOT NULL,"requestId" TEXT NOT NULL,"fingerprint" TEXT NOT NULL,"kind" TEXT NOT NULL,"result" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "EntertainmentReceipt_pkey" PRIMARY KEY("id"));
CREATE UNIQUE INDEX "EntertainmentReceipt_guildId_requestId_key" ON "EntertainmentReceipt"("guildId","requestId");
CREATE INDEX "EntertainmentReceipt_guildId_memberId_createdAt_idx" ON "EntertainmentReceipt"("guildId","memberId","createdAt");
CREATE INDEX "EntertainmentReceipt_createdAt_idx" ON "EntertainmentReceipt"("createdAt");
CREATE TABLE "CollectionTrade" ("id" TEXT NOT NULL,"guildId" TEXT NOT NULL,"sellerId" TEXT NOT NULL,"buyerId" TEXT NOT NULL,"itemId" TEXT NOT NULL,"quantity" INTEGER NOT NULL CHECK("quantity" BETWEEN 1 AND 10),"price" INTEGER NOT NULL CHECK("price" BETWEEN 0 AND 100000),"requestId" TEXT NOT NULL,"state" TEXT NOT NULL DEFAULT 'PENDING' CHECK("state" IN ('PENDING','ACCEPTED','DECLINED','CANCELLED','EXPIRED')),"expiresAt" TIMESTAMP(3) NOT NULL,"completedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "CollectionTrade_pkey" PRIMARY KEY("id"));
CREATE UNIQUE INDEX "CollectionTrade_guildId_requestId_key" ON "CollectionTrade"("guildId","requestId");
CREATE INDEX "CollectionTrade_guildId_sellerId_state_idx" ON "CollectionTrade"("guildId","sellerId","state");
CREATE INDEX "CollectionTrade_expiresAt_idx" ON "CollectionTrade"("expiresAt");
