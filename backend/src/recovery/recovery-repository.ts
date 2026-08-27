import type { JsonObject } from '../missions/mission.js';
import type {
  ActionClaim,
  BeginActionResult,
  ClaimActionInput,
  MissionCheckpoint,
  RecoveryAction,
  SaveMissionCheckpointInput,
} from './recovery.js';

export interface RecoveryRepository {
  saveCheckpoint(input: SaveMissionCheckpointInput): Promise<MissionCheckpoint>;
  findCheckpoint(missionId: string): Promise<MissionCheckpoint | null>;
  listActions(missionId: string): Promise<readonly RecoveryAction[]>;
  claimAction(input: ClaimActionInput): Promise<ActionClaim>;
  beginAction(id: string): Promise<BeginActionResult>;
  completeAction(
    id: string,
    receipt: JsonObject,
    providerReference?: string,
  ): Promise<RecoveryAction>;
  markActionUncertain(id: string, failureReason: string): Promise<RecoveryAction>;
  markActionFailed(id: string, failureReason: string): Promise<RecoveryAction>;
}
