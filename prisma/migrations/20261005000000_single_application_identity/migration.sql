-- DropForeignKey
ALTER TABLE "ApiKey" DROP CONSTRAINT "ApiKey_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "DeduplicationConfig" DROP CONSTRAINT "DeduplicationConfig_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Delivery" DROP CONSTRAINT "Delivery_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "DeliveryAttempt" DROP CONSTRAINT "DeliveryAttempt_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Destination" DROP CONSTRAINT "Destination_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "FieldMapping" DROP CONSTRAINT "FieldMapping_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "FieldMappingVersion" DROP CONSTRAINT "FieldMappingVersion_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "ImportJob" DROP CONSTRAINT "ImportJob_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "ImportRowError" DROP CONSTRAINT "ImportRowError_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "IntegrationCredential" DROP CONSTRAINT "IntegrationCredential_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "LeadDuplicate" DROP CONSTRAINT "LeadDuplicate_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "LeadProcessing" DROP CONSTRAINT "LeadProcessing_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "LeadRawPayload" DROP CONSTRAINT "LeadRawPayload_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "LeadScore" DROP CONSTRAINT "LeadScore_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "LeadSource" DROP CONSTRAINT "LeadSource_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "LeadSourceAccount" DROP CONSTRAINT "LeadSourceAccount_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "LeadStageEvent" DROP CONSTRAINT "LeadStageEvent_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Role" DROP CONSTRAINT "Role_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "RoutingResult" DROP CONSTRAINT "RoutingResult_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "RoutingRule" DROP CONSTRAINT "RoutingRule_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "RoutingRuleDestination" DROP CONSTRAINT "RoutingRuleDestination_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "ScoringRuleSet" DROP CONSTRAINT "ScoringRuleSet_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "UserSession" DROP CONSTRAINT "UserSession_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "WebhookEvent" DROP CONSTRAINT "WebhookEvent_tenantId_fkey";

-- DropIndex
DROP INDEX "ApiKey_tenantId_createdAt_idx";

-- DropIndex
DROP INDEX "ApiKey_tenantId_status_idx";

-- DropIndex
DROP INDEX "AuditLog_tenantId_createdAt_idx";

-- DropIndex
DROP INDEX "AuditLog_tenantId_entityType_entityId_idx";

-- DropIndex
DROP INDEX "DeduplicationConfig_tenantId_key";

-- DropIndex
DROP INDEX "Delivery_tenantId_destinationId_status_idx";

-- DropIndex
DROP INDEX "Delivery_tenantId_leadId_destinationId_key";

-- DropIndex
DROP INDEX "Delivery_tenantId_status_updatedAt_idx";

-- DropIndex
DROP INDEX "DeliveryAttempt_tenantId_deliveryId_attemptNumber_key";

-- DropIndex
DROP INDEX "DeliveryAttempt_tenantId_startedAt_idx";

-- DropIndex
DROP INDEX "DeliveryAttempt_tenantId_status_idx";

-- DropIndex
DROP INDEX "Destination_tenantId_name_key";

-- DropIndex
DROP INDEX "Destination_tenantId_type_status_idx";

-- DropIndex
DROP INDEX "DestinationHealth_tenantId_status_idx";

-- DropIndex
DROP INDEX "FieldMapping_tenantId_destinationId_name_key";

-- DropIndex
DROP INDEX "FieldMapping_tenantId_status_idx";

-- DropIndex
DROP INDEX "FieldMappingVersion_tenantId_idx";

-- DropIndex
DROP INDEX "ImportJob_tenantId_createdAt_idx";

-- DropIndex
DROP INDEX "ImportJob_tenantId_status_createdAt_idx";

-- DropIndex
DROP INDEX "ImportRowError_tenantId_importJobId_idx";

-- DropIndex
DROP INDEX "IntegrationCredential_tenantId_destinationId_idx";

-- DropIndex
DROP INDEX "IntegrationCredential_tenantId_sourceAccountId_idx";

-- DropIndex
DROP INDEX "IntegrationCredential_tenantId_type_idx";

-- DropIndex
DROP INDEX "Lead_tenantId_createdAt_idx";

-- DropIndex
DROP INDEX "Lead_tenantId_dedupEmailHash_idx";

-- DropIndex
DROP INDEX "Lead_tenantId_dedupPhoneHash_idx";

-- DropIndex
DROP INDEX "Lead_tenantId_sourceAccountId_externalLeadId_key";

-- DropIndex
DROP INDEX "Lead_tenantId_sourceId_createdAt_idx";

-- DropIndex
DROP INDEX "Lead_tenantId_status_createdAt_idx";

-- DropIndex
DROP INDEX "LeadDuplicate_tenantId_createdAt_idx";

-- DropIndex
DROP INDEX "LeadDuplicate_tenantId_originalLeadId_idx";

-- DropIndex
DROP INDEX "LeadProcessing_tenantId_validationStatus_idx";

-- DropIndex
DROP INDEX "LeadRawPayload_tenantId_leadId_idx";

-- DropIndex
DROP INDEX "LeadRawPayload_tenantId_receivedAt_idx";

-- DropIndex
DROP INDEX "LeadScore_tenantId_computedAt_idx";

-- DropIndex
DROP INDEX "LeadScore_tenantId_leadId_version_key";

-- DropIndex
DROP INDEX "LeadSource_tenantId_code_key";

-- DropIndex
DROP INDEX "LeadSource_tenantId_type_idx";

-- DropIndex
DROP INDEX "LeadSourceAccount_tenantId_sourceId_idx";

-- DropIndex
DROP INDEX "LeadStageEvent_tenantId_leadId_startedAt_idx";

-- DropIndex
DROP INDEX "LeadStageEvent_tenantId_stage_startedAt_idx";

-- DropIndex
DROP INDEX "Role_tenantId_idx";

-- DropIndex
DROP INDEX "Role_tenantId_name_key";

-- DropIndex
DROP INDEX "RoutingResult_tenantId_leadId_evaluatedAt_idx";

-- DropIndex
DROP INDEX "RoutingRule_tenantId_enabled_priority_idx";

-- DropIndex
DROP INDEX "RoutingRuleDestination_tenantId_destinationId_idx";

-- DropIndex
DROP INDEX "ScoringRuleSet_tenantId_enabled_idx";

-- DropIndex
DROP INDEX "ScoringRuleSet_tenantId_version_key";

-- DropIndex
DROP INDEX "User_tenantId_email_key";

-- DropIndex
DROP INDEX "User_tenantId_status_idx";

-- DropIndex
DROP INDEX "UserSession_tenantId_userId_idx";

-- DropIndex
DROP INDEX "WebhookEvent_tenantId_receivedAt_idx";

-- DropIndex
DROP INDEX "WebhookEvent_tenantId_sourceAccountId_idempotencyKey_key";

-- DropIndex
DROP INDEX "WebhookEvent_tenantId_status_receivedAt_idx";

-- AlterTable
ALTER TABLE "ApiKey" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "AuditLog" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "DeduplicationConfig" DROP COLUMN "tenantId",
ADD COLUMN     "instanceKey" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Delivery" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "DeliveryAttempt" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "Destination" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "DestinationHealth" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "FieldMapping" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "FieldMappingVersion" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "ImportJob" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "ImportRowError" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "IntegrationCredential" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "Lead" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "LeadDuplicate" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "LeadProcessing" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "LeadRawPayload" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "LeadScore" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "LeadSource" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "LeadSourceAccount" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "LeadStageEvent" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "Role" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "RoutingResult" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "RoutingRule" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "RoutingRuleDestination" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "ScoringRuleSet" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "UserSession" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "WebhookEvent" DROP COLUMN "tenantId";

-- CreateIndex
CREATE INDEX "ApiKey_status_idx" ON "ApiKey"("status");

-- CreateIndex
CREATE INDEX "ApiKey_createdAt_idx" ON "ApiKey"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "DeduplicationConfig_instanceKey_key" ON "DeduplicationConfig"("instanceKey");

-- CreateIndex
CREATE INDEX "Delivery_status_updatedAt_idx" ON "Delivery"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Delivery_destinationId_status_idx" ON "Delivery"("destinationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_leadId_destinationId_key" ON "Delivery"("leadId", "destinationId");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_startedAt_idx" ON "DeliveryAttempt"("startedAt");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_status_idx" ON "DeliveryAttempt"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAttempt_deliveryId_attemptNumber_key" ON "DeliveryAttempt"("deliveryId", "attemptNumber");

-- CreateIndex
CREATE INDEX "Destination_type_status_idx" ON "Destination"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Destination_name_key" ON "Destination"("name");

-- CreateIndex
CREATE INDEX "FieldMapping_status_idx" ON "FieldMapping"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FieldMapping_destinationId_name_key" ON "FieldMapping"("destinationId", "name");

-- CreateIndex
CREATE INDEX "ImportJob_status_createdAt_idx" ON "ImportJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ImportJob_createdAt_idx" ON "ImportJob"("createdAt");

-- CreateIndex
CREATE INDEX "ImportRowError_importJobId_idx" ON "ImportRowError"("importJobId");

-- CreateIndex
CREATE INDEX "IntegrationCredential_sourceAccountId_idx" ON "IntegrationCredential"("sourceAccountId");

-- CreateIndex
CREATE INDEX "IntegrationCredential_destinationId_idx" ON "IntegrationCredential"("destinationId");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_sourceId_createdAt_idx" ON "Lead"("sourceId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_dedupPhoneHash_idx" ON "Lead"("dedupPhoneHash");

-- CreateIndex
CREATE INDEX "Lead_dedupEmailHash_idx" ON "Lead"("dedupEmailHash");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_sourceAccountId_externalLeadId_key" ON "Lead"("sourceAccountId", "externalLeadId");

-- CreateIndex
CREATE INDEX "LeadDuplicate_originalLeadId_idx" ON "LeadDuplicate"("originalLeadId");

-- CreateIndex
CREATE INDEX "LeadDuplicate_createdAt_idx" ON "LeadDuplicate"("createdAt");

-- CreateIndex
CREATE INDEX "LeadProcessing_validationStatus_idx" ON "LeadProcessing"("validationStatus");

-- CreateIndex
CREATE INDEX "LeadRawPayload_leadId_idx" ON "LeadRawPayload"("leadId");

-- CreateIndex
CREATE INDEX "LeadRawPayload_receivedAt_idx" ON "LeadRawPayload"("receivedAt");

-- CreateIndex
CREATE INDEX "LeadScore_computedAt_idx" ON "LeadScore"("computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadScore_leadId_version_key" ON "LeadScore"("leadId", "version");

-- CreateIndex
CREATE INDEX "LeadSource_type_idx" ON "LeadSource"("type");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSource_code_key" ON "LeadSource"("code");

-- CreateIndex
CREATE INDEX "LeadSourceAccount_sourceId_idx" ON "LeadSourceAccount"("sourceId");

-- CreateIndex
CREATE INDEX "LeadStageEvent_leadId_startedAt_idx" ON "LeadStageEvent"("leadId", "startedAt");

-- CreateIndex
CREATE INDEX "LeadStageEvent_stage_startedAt_idx" ON "LeadStageEvent"("stage", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE INDEX "RoutingResult_leadId_evaluatedAt_idx" ON "RoutingResult"("leadId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "RoutingRule_enabled_priority_idx" ON "RoutingRule"("enabled", "priority");

-- CreateIndex
CREATE INDEX "RoutingRuleDestination_destinationId_idx" ON "RoutingRuleDestination"("destinationId");

-- CreateIndex
CREATE INDEX "ScoringRuleSet_enabled_idx" ON "ScoringRuleSet"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ScoringRuleSet_version_key" ON "ScoringRuleSet"("version");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_sourceAccountId_idempotencyKey_key" ON "WebhookEvent"("sourceAccountId", "idempotencyKey");
