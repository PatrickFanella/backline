-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN', 'MODERATOR', 'BANNED');

-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('FREE', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "BackupType" AS ENUM ('FULL', 'INCREMENTAL', 'WAL_ARCHIVE');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "RuleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DRAFT');

-- CreateEnum
CREATE TYPE "RuleTriggerType" AS ENUM ('SCHEDULED', 'REALTIME', 'MANUAL');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('WEBHOOK', 'NOTIFICATION', 'EMAIL', 'DISCORD_MESSAGE');

-- CreateEnum
CREATE TYPE "ConditionOperator" AS ENUM ('EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'LESS_THAN', 'GREATER_THAN_OR_EQUAL', 'LESS_THAN_OR_EQUAL', 'CONTAINS', 'NOT_CONTAINS', 'IN', 'NOT_IN');

-- CreateTable
CREATE TABLE "PresenceEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "clients" TEXT[],
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PresenceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TypingEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TypingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JoinEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "accountAgeDays" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JoinEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletedMessageEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletedMessageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReactionTime" (
    "id" TEXT NOT NULL,
    "observerId" TEXT NOT NULL,
    "observerName" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "deltaMs" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReactionTime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleChangeEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "addedRoles" TEXT[],
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleChangeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockedIP" (
    "id" SERIAL NOT NULL,
    "ip" TEXT NOT NULL,
    "reason" TEXT,
    "expiresAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedIP_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhitelistedIP" (
    "id" SERIAL NOT NULL,
    "ip" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhitelistedIP_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BannedUser" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BannedUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "discriminator" TEXT NOT NULL,
    "avatar" TEXT,
    "email" TEXT,
    "locale" TEXT,
    "verified" BOOLEAN NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "refreshTokenIssuedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accessTokenExpiresAt" TIMESTAMPTZ NOT NULL,
    "lastSeenAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "subscriptionTier" "SubscriptionTier" NOT NULL DEFAULT 'FREE',
    "analyticsConsent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guild" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "owner" BOOLEAN NOT NULL,
    "permissions" BIGINT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Guild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "role" "Role" NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("role","permissionId")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "lastActivity" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMPTZ,
    "expiresAt" TIMESTAMPTZ,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledFor" TIMESTAMPTZ NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "DeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "consentType" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "version" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRetentionPolicy" (
    "id" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastCleanupAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "DataRetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "result" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "metadata" JSONB,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertLog" (
    "id" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "sentAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAnalyticsEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "eventType" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "category" TEXT,
    "properties" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "referrer" TEXT,
    "pathname" TEXT,
    "consentGiven" BOOLEAN NOT NULL DEFAULT false,
    "anonymized" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureUsageMetric" (
    "id" TEXT NOT NULL,
    "featureName" TEXT NOT NULL,
    "userId" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "consentGiven" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureUsageMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceMetric" (
    "id" TEXT NOT NULL,
    "metricType" TEXT NOT NULL,
    "metricName" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "endpoint" TEXT,
    "userId" TEXT,
    "sessionId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSummary" (
    "id" TEXT NOT NULL,
    "summaryDate" DATE NOT NULL,
    "summaryType" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusCheck" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "database" BOOLEAN NOT NULL,
    "databaseLatency" INTEGER,
    "redis" BOOLEAN NOT NULL,
    "redisLatency" INTEGER,
    "discord" BOOLEAN NOT NULL,
    "discordLatency" INTEGER,
    "overall" BOOLEAN NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "StatusCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'INVESTIGATING',
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'MINOR',
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ,
    "affectedServices" TEXT[],
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentUpdate" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "IncidentStatus",
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupLog" (
    "id" TEXT NOT NULL,
    "backupType" "BackupType" NOT NULL,
    "status" "BackupStatus" NOT NULL,
    "filename" TEXT NOT NULL,
    "fileSizeMB" DOUBLE PRECISION,
    "duration" INTEGER,
    "s3Location" TEXT,
    "s3LocationSecondary" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ,
    "verifiedAt" TIMESTAMPTZ,

    CONSTRAINT "BackupLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "userId" TEXT NOT NULL,
    "status" "RuleStatus" NOT NULL DEFAULT 'DRAFT',
    "triggerType" "RuleTriggerType" NOT NULL DEFAULT 'SCHEDULED',
    "schedule" TEXT,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "metadata" JSONB,
    "lastExecutedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AnalyticsRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleExecution" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "actionsExecuted" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "results" JSONB,
    "executionTimeMs" INTEGER,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ,

    CONSTRAINT "RuleExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "metadata" JSONB,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RuleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PresenceEvent_userId_idx" ON "PresenceEvent"("userId");

-- CreateIndex
CREATE INDEX "PresenceEvent_createdAt_idx" ON "PresenceEvent"("createdAt");

-- CreateIndex
CREATE INDEX "PresenceEvent_userId_createdAt_idx" ON "PresenceEvent"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "TypingEvent_userId_idx" ON "TypingEvent"("userId");

-- CreateIndex
CREATE INDEX "TypingEvent_guildId_idx" ON "TypingEvent"("guildId");

-- CreateIndex
CREATE INDEX "TypingEvent_channelId_idx" ON "TypingEvent"("channelId");

-- CreateIndex
CREATE INDEX "TypingEvent_createdAt_idx" ON "TypingEvent"("createdAt");

-- CreateIndex
CREATE INDEX "TypingEvent_userId_channelId_idx" ON "TypingEvent"("userId", "channelId");

-- CreateIndex
CREATE INDEX "TypingEvent_guildId_createdAt_idx" ON "TypingEvent"("guildId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MessageEvent_userId_idx" ON "MessageEvent"("userId");

-- CreateIndex
CREATE INDEX "MessageEvent_guildId_idx" ON "MessageEvent"("guildId");

-- CreateIndex
CREATE INDEX "MessageEvent_channelId_idx" ON "MessageEvent"("channelId");

-- CreateIndex
CREATE INDEX "MessageEvent_createdAt_idx" ON "MessageEvent"("createdAt");

-- CreateIndex
CREATE INDEX "MessageEvent_userId_createdAt_idx" ON "MessageEvent"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MessageEvent_guildId_channelId_idx" ON "MessageEvent"("guildId", "channelId");

-- CreateIndex
CREATE INDEX "MessageEvent_guildId_createdAt_idx" ON "MessageEvent"("guildId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "JoinEvent_userId_idx" ON "JoinEvent"("userId");

-- CreateIndex
CREATE INDEX "JoinEvent_guildId_idx" ON "JoinEvent"("guildId");

-- CreateIndex
CREATE INDEX "JoinEvent_createdAt_idx" ON "JoinEvent"("createdAt");

-- CreateIndex
CREATE INDEX "JoinEvent_guildId_createdAt_idx" ON "JoinEvent"("guildId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "DeletedMessageEvent_userId_idx" ON "DeletedMessageEvent"("userId");

-- CreateIndex
CREATE INDEX "DeletedMessageEvent_guildId_idx" ON "DeletedMessageEvent"("guildId");

-- CreateIndex
CREATE INDEX "DeletedMessageEvent_channelId_idx" ON "DeletedMessageEvent"("channelId");

-- CreateIndex
CREATE INDEX "DeletedMessageEvent_createdAt_idx" ON "DeletedMessageEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ReactionTime_observerId_idx" ON "ReactionTime"("observerId");

-- CreateIndex
CREATE INDEX "ReactionTime_actorId_idx" ON "ReactionTime"("actorId");

-- CreateIndex
CREATE INDEX "ReactionTime_guildId_idx" ON "ReactionTime"("guildId");

-- CreateIndex
CREATE INDEX "ReactionTime_createdAt_idx" ON "ReactionTime"("createdAt");

-- CreateIndex
CREATE INDEX "ReactionTime_observerId_createdAt_idx" ON "ReactionTime"("observerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ReactionTime_guildId_createdAt_idx" ON "ReactionTime"("guildId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ReactionTime_deltaMs_idx" ON "ReactionTime"("deltaMs");

-- CreateIndex
CREATE INDEX "RoleChangeEvent_userId_idx" ON "RoleChangeEvent"("userId");

-- CreateIndex
CREATE INDEX "RoleChangeEvent_guildId_idx" ON "RoleChangeEvent"("guildId");

-- CreateIndex
CREATE INDEX "RoleChangeEvent_createdAt_idx" ON "RoleChangeEvent"("createdAt");

-- CreateIndex
CREATE INDEX "RoleChangeEvent_guildId_createdAt_idx" ON "RoleChangeEvent"("guildId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "BlockedIP_ip_key" ON "BlockedIP"("ip");

-- CreateIndex
CREATE INDEX "BlockedIP_ip_idx" ON "BlockedIP"("ip");

-- CreateIndex
CREATE INDEX "BlockedIP_expiresAt_idx" ON "BlockedIP"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhitelistedIP_ip_key" ON "WhitelistedIP"("ip");

-- CreateIndex
CREATE INDEX "WhitelistedIP_ip_idx" ON "WhitelistedIP"("ip");

-- CreateIndex
CREATE UNIQUE INDEX "BannedUser_userId_key" ON "BannedUser"("userId");

-- CreateIndex
CREATE INDEX "BannedUser_userId_idx" ON "BannedUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");

-- CreateIndex
CREATE INDEX "User_discordId_idx" ON "User"("discordId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_subscriptionTier_idx" ON "User"("subscriptionTier");

-- CreateIndex
CREATE INDEX "User_lastSeenAt_idx" ON "User"("lastSeenAt" DESC);

-- CreateIndex
CREATE INDEX "User_role_lastSeenAt_idx" ON "User"("role", "lastSeenAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Guild_guildId_key" ON "Guild"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_name_key" ON "Permission"("name");

-- CreateIndex
CREATE INDEX "Permission_category_idx" ON "Permission"("category");

-- CreateIndex
CREATE INDEX "Permission_name_idx" ON "Permission"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "RefreshToken_token_idx" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_key_key" ON "ApiKey"("key");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE INDEX "ApiKey_key_idx" ON "ApiKey"("key");

-- CreateIndex
CREATE INDEX "LoginLog_userId_idx" ON "LoginLog"("userId");

-- CreateIndex
CREATE INDEX "LoginLog_createdAt_idx" ON "LoginLog"("createdAt");

-- CreateIndex
CREATE INDEX "LoginLog_ipAddress_idx" ON "LoginLog"("ipAddress");

-- CreateIndex
CREATE UNIQUE INDEX "DeletionRequest_userId_key" ON "DeletionRequest"("userId");

-- CreateIndex
CREATE INDEX "DeletionRequest_status_idx" ON "DeletionRequest"("status");

-- CreateIndex
CREATE INDEX "DeletionRequest_scheduledFor_idx" ON "DeletionRequest"("scheduledFor");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_ipAddress_idx" ON "AuditLog"("ipAddress");

-- CreateIndex
CREATE INDEX "ConsentLog_userId_idx" ON "ConsentLog"("userId");

-- CreateIndex
CREATE INDEX "ConsentLog_consentType_idx" ON "ConsentLog"("consentType");

-- CreateIndex
CREATE UNIQUE INDEX "DataRetentionPolicy_dataType_key" ON "DataRetentionPolicy"("dataType");

-- CreateIndex
CREATE INDEX "DataRetentionPolicy_dataType_idx" ON "DataRetentionPolicy"("dataType");

-- CreateIndex
CREATE INDEX "DataRetentionPolicy_enabled_idx" ON "DataRetentionPolicy"("enabled");

-- CreateIndex
CREATE INDEX "SecurityLog_userId_idx" ON "SecurityLog"("userId");

-- CreateIndex
CREATE INDEX "SecurityLog_action_idx" ON "SecurityLog"("action");

-- CreateIndex
CREATE INDEX "SecurityLog_timestamp_idx" ON "SecurityLog"("timestamp");

-- CreateIndex
CREATE INDEX "SecurityLog_ipAddress_idx" ON "SecurityLog"("ipAddress");

-- CreateIndex
CREATE INDEX "SecurityLog_result_idx" ON "SecurityLog"("result");

-- CreateIndex
CREATE INDEX "AlertLog_severity_idx" ON "AlertLog"("severity");

-- CreateIndex
CREATE INDEX "AlertLog_sentAt_idx" ON "AlertLog"("sentAt");

-- CreateIndex
CREATE INDEX "UserAnalyticsEvent_userId_idx" ON "UserAnalyticsEvent"("userId");

-- CreateIndex
CREATE INDEX "UserAnalyticsEvent_sessionId_idx" ON "UserAnalyticsEvent"("sessionId");

-- CreateIndex
CREATE INDEX "UserAnalyticsEvent_eventType_idx" ON "UserAnalyticsEvent"("eventType");

-- CreateIndex
CREATE INDEX "UserAnalyticsEvent_eventName_idx" ON "UserAnalyticsEvent"("eventName");

-- CreateIndex
CREATE INDEX "UserAnalyticsEvent_category_idx" ON "UserAnalyticsEvent"("category");

-- CreateIndex
CREATE INDEX "UserAnalyticsEvent_createdAt_idx" ON "UserAnalyticsEvent"("createdAt");

-- CreateIndex
CREATE INDEX "UserAnalyticsEvent_userId_createdAt_idx" ON "UserAnalyticsEvent"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "UserAnalyticsEvent_eventType_createdAt_idx" ON "UserAnalyticsEvent"("eventType", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "UserAnalyticsEvent_consentGiven_idx" ON "UserAnalyticsEvent"("consentGiven");

-- CreateIndex
CREATE INDEX "FeatureUsageMetric_featureName_idx" ON "FeatureUsageMetric"("featureName");

-- CreateIndex
CREATE INDEX "FeatureUsageMetric_userId_idx" ON "FeatureUsageMetric"("userId");

-- CreateIndex
CREATE INDEX "FeatureUsageMetric_lastUsedAt_idx" ON "FeatureUsageMetric"("lastUsedAt");

-- CreateIndex
CREATE INDEX "FeatureUsageMetric_featureName_createdAt_idx" ON "FeatureUsageMetric"("featureName", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PerformanceMetric_metricType_idx" ON "PerformanceMetric"("metricType");

-- CreateIndex
CREATE INDEX "PerformanceMetric_metricName_idx" ON "PerformanceMetric"("metricName");

-- CreateIndex
CREATE INDEX "PerformanceMetric_endpoint_idx" ON "PerformanceMetric"("endpoint");

-- CreateIndex
CREATE INDEX "PerformanceMetric_createdAt_idx" ON "PerformanceMetric"("createdAt");

-- CreateIndex
CREATE INDEX "PerformanceMetric_metricType_createdAt_idx" ON "PerformanceMetric"("metricType", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AnalyticsSummary_summaryDate_idx" ON "AnalyticsSummary"("summaryDate");

-- CreateIndex
CREATE INDEX "AnalyticsSummary_summaryType_idx" ON "AnalyticsSummary"("summaryType");

-- CreateIndex
CREATE INDEX "AnalyticsSummary_metric_idx" ON "AnalyticsSummary"("metric");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSummary_summaryDate_summaryType_metric_key" ON "AnalyticsSummary"("summaryDate", "summaryType", "metric");

-- CreateIndex
CREATE INDEX "StatusCheck_timestamp_idx" ON "StatusCheck"("timestamp" DESC);

-- CreateIndex
CREATE INDEX "StatusCheck_status_idx" ON "StatusCheck"("status");

-- CreateIndex
CREATE INDEX "StatusCheck_overall_idx" ON "StatusCheck"("overall");

-- CreateIndex
CREATE INDEX "Incident_status_idx" ON "Incident"("status");

-- CreateIndex
CREATE INDEX "Incident_severity_idx" ON "Incident"("severity");

-- CreateIndex
CREATE INDEX "Incident_startedAt_idx" ON "Incident"("startedAt" DESC);

-- CreateIndex
CREATE INDEX "IncidentUpdate_incidentId_idx" ON "IncidentUpdate"("incidentId");

-- CreateIndex
CREATE INDEX "IncidentUpdate_createdAt_idx" ON "IncidentUpdate"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "BackupLog_backupType_idx" ON "BackupLog"("backupType");

-- CreateIndex
CREATE INDEX "BackupLog_status_idx" ON "BackupLog"("status");

-- CreateIndex
CREATE INDEX "BackupLog_startedAt_idx" ON "BackupLog"("startedAt" DESC);

-- CreateIndex
CREATE INDEX "BackupLog_completedAt_idx" ON "BackupLog"("completedAt" DESC);

-- CreateIndex
CREATE INDEX "AnalyticsRule_userId_idx" ON "AnalyticsRule"("userId");

-- CreateIndex
CREATE INDEX "AnalyticsRule_status_idx" ON "AnalyticsRule"("status");

-- CreateIndex
CREATE INDEX "AnalyticsRule_triggerType_idx" ON "AnalyticsRule"("triggerType");

-- CreateIndex
CREATE INDEX "AnalyticsRule_lastExecutedAt_idx" ON "AnalyticsRule"("lastExecutedAt");

-- CreateIndex
CREATE INDEX "AnalyticsRule_userId_status_idx" ON "AnalyticsRule"("userId", "status");

-- CreateIndex
CREATE INDEX "RuleExecution_ruleId_idx" ON "RuleExecution"("ruleId");

-- CreateIndex
CREATE INDEX "RuleExecution_status_idx" ON "RuleExecution"("status");

-- CreateIndex
CREATE INDEX "RuleExecution_startedAt_idx" ON "RuleExecution"("startedAt" DESC);

-- CreateIndex
CREATE INDEX "RuleExecution_ruleId_startedAt_idx" ON "RuleExecution"("ruleId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "RuleTemplate_category_idx" ON "RuleTemplate"("category");

-- CreateIndex
CREATE INDEX "RuleTemplate_usageCount_idx" ON "RuleTemplate"("usageCount" DESC);

-- AddForeignKey
ALTER TABLE "Guild" ADD CONSTRAINT "Guild_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginLog" ADD CONSTRAINT "LoginLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletionRequest" ADD CONSTRAINT "DeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentLog" ADD CONSTRAINT "ConsentLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentUpdate" ADD CONSTRAINT "IncidentUpdate_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleExecution" ADD CONSTRAINT "RuleExecution_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AnalyticsRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

