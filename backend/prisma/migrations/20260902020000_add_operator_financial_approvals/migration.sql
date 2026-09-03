ALTER TYPE "MissionStatus" ADD VALUE 'AWAITING_FUNDING_APPROVAL';
ALTER TYPE "MissionStatus" ADD VALUE 'AWAITING_BASE_APPROVAL';
ALTER TYPE "VirtualsJobState" ADD VALUE 'AWAITING_FUNDING_APPROVAL';

CREATE TYPE "OperatorApprovalKind" AS ENUM ('ACP_FUNDING', 'BASE_SETTLEMENT');
CREATE TYPE "OperatorApprovalStatus" AS ENUM ('APPROVED', 'CONSUMED', 'CANCELLED');

CREATE TABLE "OperatorApproval" (
    "id" UUID NOT NULL,
    "missionId" UUID NOT NULL,
    "kind" "OperatorApprovalKind" NOT NULL,
    "actionId" VARCHAR(200) NOT NULL,
    "referenceId" VARCHAR(300) NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "currency" VARCHAR(16) NOT NULL,
    "status" "OperatorApprovalStatus" NOT NULL DEFAULT 'APPROVED',
    "approvedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OperatorApproval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperatorApproval_missionId_kind_actionId_key"
ON "OperatorApproval"("missionId", "kind", "actionId");

CREATE INDEX "OperatorApproval_missionId_status_createdAt_idx"
ON "OperatorApproval"("missionId", "status", "createdAt");

ALTER TABLE "OperatorApproval"
ADD CONSTRAINT "OperatorApproval_missionId_fkey"
FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
