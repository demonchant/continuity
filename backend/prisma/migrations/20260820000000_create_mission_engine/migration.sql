-- CreateEnum
CREATE TYPE "MissionStatus" AS ENUM (
  'CREATED',
  'PLANNING',
  'SELECTING_AGENT',
  'EXECUTING',
  'VERIFYING',
  'COMPLETED',
  'FAILED',
  'RECOVERING',
  'CANCELLED'
);

-- CreateTable
CREATE TABLE "Mission" (
  "id" UUID NOT NULL,
  "objective" TEXT NOT NULL,
  "constraints" JSONB NOT NULL DEFAULT '{}',
  "budget" DECIMAL(20,8) NOT NULL,
  "status" "MissionStatus" NOT NULL DEFAULT 'CREATED',
  "currentStep" VARCHAR(100) NOT NULL DEFAULT 'created',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionTransition" (
  "id" UUID NOT NULL,
  "missionId" UUID NOT NULL,
  "fromStatus" "MissionStatus",
  "toStatus" "MissionStatus" NOT NULL,
  "reason" VARCHAR(500),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MissionTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Mission_status_updatedAt_idx" ON "Mission"("status", "updatedAt");
CREATE INDEX "Mission_createdAt_idx" ON "Mission"("createdAt");
CREATE INDEX "MissionTransition_missionId_createdAt_idx" ON "MissionTransition"("missionId", "createdAt");

-- AddForeignKey
ALTER TABLE "MissionTransition"
ADD CONSTRAINT "MissionTransition_missionId_fkey"
FOREIGN KEY ("missionId") REFERENCES "Mission"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
