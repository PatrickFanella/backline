CREATE TABLE "MemberAfk" (
"guildId" TEXT NOT NULL,"memberId" TEXT NOT NULL,"reason" TEXT NOT NULL CHECK(length("reason") BETWEEN 1 AND 160),
"setAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"expiresAt" TIMESTAMPTZ NOT NULL,"lastNoticeAt" TIMESTAMPTZ,
PRIMARY KEY("guildId","memberId"));
CREATE INDEX "MemberAfk_expiresAt_idx" ON "MemberAfk"("expiresAt");
CREATE TABLE "MemberBirthday" (
"guildId" TEXT NOT NULL,"memberId" TEXT NOT NULL,"month" INTEGER NOT NULL CHECK("month" BETWEEN 1 AND 12),
"day" INTEGER NOT NULL CHECK("day" BETWEEN 1 AND 31),"updatedAt" TIMESTAMPTZ NOT NULL,
PRIMARY KEY("guildId","memberId"));
