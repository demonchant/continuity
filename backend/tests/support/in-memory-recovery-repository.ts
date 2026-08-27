import { randomUUID } from 'node:crypto';
import type { JsonObject } from '../../src/missions/mission.js';
import type { RecoveryRepository } from '../../src/recovery/recovery-repository.js';
import type {
  ActionClaim,
  BeginActionResult,
  ClaimActionInput,
  MissionCheckpoint,
  RecoveryAction,
  SaveMissionCheckpointInput,
} from '../../src/recovery/recovery.js';

export class InMemoryRecoveryRepository implements RecoveryRepository {
  private readonly checkpoints = new Map<string, MissionCheckpoint>();
  private readonly actions = new Map<string, RecoveryAction>();
  private readonly actionKeys = new Map<string, string>();
  private readonly paymentKeys = new Map<string, string>();
  private tick = 0;

  private now(): Date {
    return new Date(Date.UTC(2026, 7, 21, 12, 0, 0, this.tick++));
  }

  saveCheckpoint(input: SaveMissionCheckpointInput): Promise<MissionCheckpoint> {
    const prior = this.checkpoints.get(input.missionId);
    const now = this.now();
    const checkpoint: MissionCheckpoint = {
      missionId: input.missionId,
      missionState: input.missionState,
      currentStep: input.currentStep,
      ...(input.selectedAgentId ? { selectedAgentId: input.selectedAgentId } : {}),
      actionState: input.actionState,
      paymentState: input.paymentState,
      verificationState: input.verificationState,
      recoveryInfo: input.recoveryInfo,
      nextAction: input.nextAction,
      version: (prior?.version ?? 0) + 1,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    };
    this.checkpoints.set(input.missionId, checkpoint);
    return Promise.resolve(checkpoint);
  }

  findCheckpoint(missionId: string): Promise<MissionCheckpoint | null> {
    return Promise.resolve(this.checkpoints.get(missionId) ?? null);
  }

  listActions(missionId: string): Promise<readonly RecoveryAction[]> {
    return Promise.resolve(
      [...this.actions.values()]
        .filter((action) => action.missionId === missionId)
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()),
    );
  }

  claimAction(input: ClaimActionInput): Promise<ActionClaim> {
    const actionKey = `${input.missionId}:${input.actionId}`;
    const actionMatch = this.actionKeys.get(actionKey);
    if (actionMatch) {
      return Promise.resolve({
        action: this.actions.get(actionMatch)!,
        created: false,
        matchedBy: 'actionId',
      });
    }
    if (input.paymentId) {
      const paymentMatch = this.paymentKeys.get(input.paymentId);
      if (paymentMatch) {
        return Promise.resolve({
          action: this.actions.get(paymentMatch)!,
          created: false,
          matchedBy: 'paymentId',
        });
      }
    }
    const now = this.now();
    const action: RecoveryAction = {
      id: randomUUID(),
      missionId: input.missionId,
      actionId: input.actionId,
      ...(input.paymentId ? { paymentId: input.paymentId } : {}),
      kind: input.kind,
      status: 'INTENDED',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.actions.set(action.id, action);
    this.actionKeys.set(actionKey, action.id);
    if (input.paymentId) this.paymentKeys.set(input.paymentId, action.id);
    return Promise.resolve({ action, created: true, matchedBy: 'created' });
  }

  beginAction(id: string): Promise<BeginActionResult> {
    const action = this.required(id);
    if (action.status !== 'INTENDED') return Promise.resolve({ action, started: false });
    const updated: RecoveryAction = {
      ...action,
      status: 'IN_PROGRESS',
      attempts: action.attempts + 1,
      updatedAt: this.now(),
    };
    this.actions.set(id, updated);
    return Promise.resolve({ action: updated, started: true });
  }

  completeAction(
    id: string,
    receipt: JsonObject,
    providerReference?: string,
  ): Promise<RecoveryAction> {
    const action = this.required(id);
    const now = this.now();
    const updated: RecoveryAction = {
      ...action,
      status: 'COMPLETED',
      receipt,
      ...(providerReference ? { providerReference } : {}),
      updatedAt: now,
      completedAt: now,
    };
    this.actions.set(id, updated);
    return Promise.resolve(updated);
  }

  markActionUncertain(id: string, failureReason: string): Promise<RecoveryAction> {
    return Promise.resolve(this.updateFailure(id, 'UNCERTAIN', failureReason));
  }

  markActionFailed(id: string, failureReason: string): Promise<RecoveryAction> {
    return Promise.resolve(this.updateFailure(id, 'FAILED', failureReason));
  }

  private updateFailure(
    id: string,
    status: 'FAILED' | 'UNCERTAIN',
    failureReason: string,
  ): RecoveryAction {
    const action = this.required(id);
    const updated: RecoveryAction = { ...action, status, failureReason, updatedAt: this.now() };
    this.actions.set(id, updated);
    return updated;
  }

  private required(id: string): RecoveryAction {
    const action = this.actions.get(id);
    if (!action) throw new Error(`Recovery action not found: ${id}`);
    return action;
  }
}
