CREATE TYPE "BaseTransactionStatus" AS ENUM ('INTENDED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'UNCERTAIN');

CREATE TABLE "BaseTransaction" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "missionId" UUID NOT NULL,
  "actionId" VARCHAR(200) NOT NULL,
  "paymentId" VARCHAR(200) NOT NULL,
  "agentId" VARCHAR(300) NOT NULL,
  "transactionHash" VARCHAR(66),
  "network" VARCHAR(50) NOT NULL,
  "chainId" INTEGER NOT NULL,
  "action" VARCHAR(100) NOT NULL,
  "recipient" VARCHAR(42) NOT NULL,
  "amount" DECIMAL(36,18) NOT NULL,
  "asset" VARCHAR(20) NOT NULL,
  "status" "BaseTransactionStatus" NOT NULL DEFAULT 'INTENDED',
  "blockNumber" BIGINT,
  "confirmations" INTEGER,
  "explorerUrl" VARCHAR(500),
  "errorCode" VARCHAR(100),
  "errorMessage" VARCHAR(500),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "confirmedAt" TIMESTAMPTZ(3),
  CONSTRAINT "BaseTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BaseTransaction_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BaseTransaction_paymentId_key" ON "BaseTransaction"("paymentId");
CREATE UNIQUE INDEX "BaseTransaction_transactionHash_key" ON "BaseTransaction"("transactionHash");
CREATE UNIQUE INDEX "BaseTransaction_missionId_actionId_key" ON "BaseTransaction"("missionId", "actionId");
CREATE INDEX "BaseTransaction_missionId_status_updatedAt_idx" ON "BaseTransaction"("missionId", "status", "updatedAt");
