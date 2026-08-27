CREATE TYPE "VirtualsJobState" AS ENUM (
    'CREATED',
    'OPEN',
    'BUDGET_PROPOSED',
    'FUNDED',
    'SUBMITTED',
    'COMPLETED',
    'REJECTED',
    'EXPIRED',
    'FAILED'
);

CREATE TABLE "VirtualsJob" (
    "id" UUID NOT NULL,
    "missionId" UUID NOT NULL,
    "actionId" VARCHAR(200) NOT NULL,
    "externalJobId" VARCHAR(100) NOT NULL,
    "chainId" INTEGER NOT NULL,
    "agentId" VARCHAR(300) NOT NULL,
    "providerAddress" VARCHAR(200) NOT NULL,
    "offeringName" VARCHAR(300) NOT NULL,
    "state" "VirtualsJobState" NOT NULL DEFAULT 'CREATED',
    "requirement" JSONB NOT NULL,
    "result" JSONB,
    "verification" JSONB,
    "errorCode" VARCHAR(100),
    "errorMessage" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    CONSTRAINT "VirtualsJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VirtualsJob_missionId_actionId_key" ON "VirtualsJob"("missionId", "actionId");
CREATE UNIQUE INDEX "VirtualsJob_chainId_externalJobId_key" ON "VirtualsJob"("chainId", "externalJobId");
CREATE INDEX "VirtualsJob_missionId_state_updatedAt_idx" ON "VirtualsJob"("missionId", "state", "updatedAt");

ALTER TABLE "VirtualsJob" ADD CONSTRAINT "VirtualsJob_missionId_fkey"
    FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
