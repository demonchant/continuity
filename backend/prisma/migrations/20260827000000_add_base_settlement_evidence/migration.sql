ALTER TABLE "BaseTransaction"
ADD COLUMN "verificationId" VARCHAR(200),
ADD COLUMN "memoryRecordId" VARCHAR(200),
ADD COLUMN "sibylRecordId" VARCHAR(200),
ADD COLUMN "sibylEventId" VARCHAR(200);

CREATE INDEX "BaseTransaction_verificationId_idx" ON "BaseTransaction"("verificationId");
