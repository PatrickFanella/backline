CREATE TABLE "OAuthState" (
 "stateHash" TEXT NOT NULL PRIMARY KEY,
 "browserHash" TEXT NOT NULL,
 "expiresAt" TIMESTAMPTZ NOT NULL
);
CREATE INDEX "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");
