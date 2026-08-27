ALTER TYPE "MissionStatus" ADD VALUE IF NOT EXISTS 'QUEUED' AFTER 'CREATED';

ALTER TABLE "Mission"
ADD COLUMN "recoveryState" VARCHAR(100),
ADD COLUMN "lastHeartbeat" TIMESTAMPTZ(3),
ADD COLUMN "lastReconciliation" TIMESTAMPTZ(3),
ADD COLUMN "recoveryFailureReason" VARCHAR(1000);

CREATE TABLE "MissionRecoveryAudit" (
  "id" UUID NOT NULL,
  "missionId" UUID NOT NULL,
  "workerId" VARCHAR(200) NOT NULL,
  "action" VARCHAR(200) NOT NULL,
  "status" VARCHAR(50) NOT NULL,
  "attempt" INTEGER NOT NULL,
  "details" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MissionRecoveryAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MissionRecoveryAudit_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MissionRecoveryAudit_missionId_createdAt_idx" ON "MissionRecoveryAudit"("missionId", "createdAt");
CREATE INDEX "MissionRecoveryAudit_status_createdAt_idx" ON "MissionRecoveryAudit"("status", "createdAt");

CREATE TABLE "MissionWorkerLease" (
  "id" VARCHAR(100) NOT NULL,
  "ownerId" VARCHAR(200) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "MissionWorkerLease_pkey" PRIMARY KEY ("id")
);
