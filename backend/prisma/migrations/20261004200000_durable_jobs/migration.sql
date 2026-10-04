CREATE TABLE "DurableJob" (
 "id" TEXT NOT NULL PRIMARY KEY, "guildId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
 "kind" TEXT NOT NULL, "moduleId" TEXT, "idempotencyKey" TEXT NOT NULL,
 "payload" JSONB NOT NULL, "state" TEXT NOT NULL DEFAULT 'PENDING',
 "runAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMPTZ NOT NULL,
 "leaseOwner" TEXT, "leaseUntil" TIMESTAMPTZ, "attempts" INTEGER NOT NULL DEFAULT 0,
 "maxAttempts" INTEGER NOT NULL DEFAULT 5, "lastError" TEXT, "result" JSONB,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ NOT NULL,
 CONSTRAINT "DurableJob_state_check" CHECK ("state" IN ('PENDING','LEASED','DELIVERED','FAILED','CANCELLED','RECONCILE')),
 CONSTRAINT "DurableJob_attempts_check" CHECK ("attempts" >= 0 AND "maxAttempts" BETWEEN 1 AND 10)
);
CREATE UNIQUE INDEX "DurableJob_guildId_idempotencyKey_key" ON "DurableJob"("guildId", "idempotencyKey");
CREATE INDEX "DurableJob_state_runAt_idx" ON "DurableJob"("state", "runAt");
CREATE INDEX "DurableJob_guildId_createdAt_idx" ON "DurableJob"("guildId", "createdAt");
CREATE TABLE "JobAttempt" (
 "id" TEXT NOT NULL PRIMARY KEY, "jobId" TEXT NOT NULL, "number" INTEGER NOT NULL,
 "owner" TEXT NOT NULL, "outcome" TEXT NOT NULL DEFAULT 'RUNNING', "detail" TEXT,
 "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMPTZ,
 CONSTRAINT "JobAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DurableJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "JobAttempt_jobId_number_key" ON "JobAttempt"("jobId", "number");
