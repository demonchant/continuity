ALTER TABLE "VirtualsJob"
ADD COLUMN "evidenceHash" VARCHAR(64),
ADD COLUMN "provenance" JSONB;

CREATE INDEX "VirtualsJob_evidenceHash_idx" ON "VirtualsJob"("evidenceHash");
