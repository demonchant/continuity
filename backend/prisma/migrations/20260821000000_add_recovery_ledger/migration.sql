CREATE TYPE "RecoveryActionStatus" AS ENUM ('INTENDED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'UNCERTAIN');

CREATE TABLE "MissionCheckpoint" (
    "missionId" UUID NOT NULL,
    "missionState" "MissionStatus" NOT NULL,
    "currentStep" VARCHAR(100) NOT NULL,
    "selectedAgentId" VARCHAR(200),
    "actionState" JSONB NOT NULL,
    "paymentState" JSONB NOT NULL,
    "verificationState" JSONB NOT NULL,
    "recoveryInfo" JSONB NOT NULL,
    "nextAction" VARCHAR(200) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "MissionCheckpoint_pkey" PRIMARY KEY ("missionId")
);

CREATE TABLE "RecoveryAction" (
    "id" UUID NOT NULL,
    "missionId" UUID NOT NULL,
    "actionId" VARCHAR(200) NOT NULL,
    "paymentId" VARCHAR(200),
    "kind" VARCHAR(100) NOT NULL,
    "status" "RecoveryActionStatus" NOT NULL DEFAULT 'INTENDED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerReference" VARCHAR(500),
    "receipt" JSONB,
    "failureReason" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    CONSTRAINT "RecoveryAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecoveryAction_paymentId_key" ON "RecoveryAction"("paymentId");
CREATE UNIQUE INDEX "RecoveryAction_missionId_actionId_key" ON "RecoveryAction"("missionId", "actionId");
CREATE INDEX "RecoveryAction_missionId_status_updatedAt_idx" ON "RecoveryAction"("missionId", "status", "updatedAt");
CREATE INDEX "MissionCheckpoint_missionState_updatedAt_idx" ON "MissionCheckpoint"("missionState", "updatedAt");

ALTER TABLE "MissionCheckpoint" ADD CONSTRAINT "MissionCheckpoint_missionId_fkey"
    FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecoveryAction" ADD CONSTRAINT "RecoveryAction_missionId_fkey"
    FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
