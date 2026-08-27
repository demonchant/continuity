DROP INDEX IF EXISTS "Mission_createdAt_idx";
CREATE INDEX "Mission_createdAt_id_idx" ON "Mission"("createdAt", "id");

CREATE INDEX "BaseTransaction_missionId_createdAt_idx"
ON "BaseTransaction"("missionId", "createdAt");

CREATE INDEX "VirtualsJob_missionId_createdAt_idx"
ON "VirtualsJob"("missionId", "createdAt");

CREATE INDEX "RecoveryAction_missionId_createdAt_idx"
ON "RecoveryAction"("missionId", "createdAt");
