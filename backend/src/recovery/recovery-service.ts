import type { Logger } from 'pino';
import type { MemoryService } from '../memory/memory-service.js';
import type { JsonObject } from '../missions/mission.js';
import { isMissionStatus } from '../missions/mission.js';
import { AppError } from '../shared/errors/app-error.js';
import type { RecoveryRepository } from './recovery-repository.js';
import type {
  ClaimActionInput,
  CriticalActionEffectResult,
  CriticalActionResult,
  ReconciliationResult,
  RecoveryAction,
  RecoveryPlan,
  SaveMissionCheckpointInput,
} from './recovery.js';

function recoveryError(
  code: string,
  message: string,
  details?: unknown,
  cause?: unknown,
): AppError {
  return new AppError({
    statusCode: 409,
    code,
    message,
    ...(details === undefined ? {} : { details }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function assertIdentity(action: RecoveryAction, input: ClaimActionInput): void {
  const paymentMismatch = input.paymentId !== action.paymentId;
  if (action.missionId !== input.missionId || action.kind !== input.kind || paymentMismatch) {
    throw recoveryError(
      'IDEMPOTENCY_KEY_CONFLICT',
      'The idempotency key is already bound to a different critical action',
      { missionId: input.missionId, actionId: input.actionId, paymentId: input.paymentId },
    );
  }
}

function completedResult(action: RecoveryAction): CriticalActionResult {
  if (!action.receipt) {
    throw recoveryError('RECOVERY_STATE_CORRUPT', 'A completed action has no durable receipt', {
      missionId: action.missionId,
      actionId: action.actionId,
    });
  }
  return { action, receipt: action.receipt, deduplicated: true };
}

const actionStatuses = new Set(['INTENDED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'UNCERTAIN']);
const actionSnapshotStatuses = new Set(['NOT_STARTED', ...actionStatuses]);
const paymentSnapshotStatuses = new Set(['NOT_APPLICABLE', 'NOT_STARTED', ...actionStatuses]);
const verificationStatuses = new Set(['NOT_STARTED', 'PENDING', 'PASS', 'FAIL']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRecoveryIntegrity(
  checkpoint: Awaited<ReturnType<RecoveryRepository['findCheckpoint']>> & object,
  actions: readonly RecoveryAction[],
): void {
  const corruptCheckpoint =
    !isMissionStatus(checkpoint.missionState) ||
    typeof checkpoint.currentStep !== 'string' ||
    checkpoint.currentStep.trim().length === 0 ||
    typeof checkpoint.nextAction !== 'string' ||
    checkpoint.nextAction.trim().length === 0 ||
    !Number.isInteger(checkpoint.version) ||
    checkpoint.version < 1 ||
    !isObject(checkpoint.actionState) ||
    !actionSnapshotStatuses.has(checkpoint.actionState.status) ||
    !isObject(checkpoint.paymentState) ||
    !paymentSnapshotStatuses.has(checkpoint.paymentState.status) ||
    !isObject(checkpoint.verificationState) ||
    !verificationStatuses.has(checkpoint.verificationState.status) ||
    !isObject(checkpoint.recoveryInfo) ||
    typeof checkpoint.recoveryInfo.interrupted !== 'boolean';
  const corruptAction = actions.some(
    (action) =>
      !action.missionId ||
      !action.actionId ||
      !action.kind ||
      !actionStatuses.has(action.status) ||
      !Number.isInteger(action.attempts) ||
      action.attempts < 0 ||
      (action.status === 'COMPLETED' && !isObject(action.receipt)),
  );
  if (corruptCheckpoint || corruptAction) {
    throw recoveryError(
      'RECOVERY_STATE_CORRUPT',
      'Persisted recovery state failed integrity validation',
      { missionId: checkpoint.missionId },
    );
  }
}

export class RecoveryService {
  constructor(
    private readonly repository: RecoveryRepository,
    private readonly memory: MemoryService,
    private readonly logger: Logger,
  ) {}

  listActions(missionId: string): Promise<readonly RecoveryAction[]> {
    return this.repository.listActions(missionId);
  }

  async checkpoint(input: SaveMissionCheckpointInput) {
    const checkpoint = await this.repository.saveCheckpoint(input);
    const recovery = {
      missionState: checkpoint.missionState,
      currentStep: checkpoint.currentStep,
      ...(checkpoint.selectedAgentId ? { selectedAgentId: checkpoint.selectedAgentId } : {}),
      actionStatus: checkpoint.actionState.status,
      paymentStatus: checkpoint.paymentState.status,
      verificationStatus: checkpoint.verificationState.status,
      nextAction: checkpoint.nextAction,
    };
    await this.memory.recordCheckpoint({
      category: 'recovery_checkpoint',
      missionId: checkpoint.missionId,
      mission: input.mission,
      capability: input.capability,
      ...(checkpoint.selectedAgentId ? { agentId: checkpoint.selectedAgentId } : {}),
      state: JSON.stringify(recovery),
      nextAction: checkpoint.nextAction,
      result: `Checkpoint ${checkpoint.version}: ${checkpoint.missionState}/${checkpoint.currentStep}; next ${checkpoint.nextAction}.`,
      recommendation: checkpoint.recoveryInfo.interrupted
        ? `Resume from ${checkpoint.recoveryInfo.resumeFrom ?? checkpoint.nextAction}; never repeat completed or ambiguous actions.`
        : `Continue with ${checkpoint.nextAction}.`,
      recovery,
      tags: ['mission-checkpoint', `checkpoint-version:${checkpoint.version}`],
    });
    this.logger.info(
      {
        event: 'recovery.checkpoint',
        missionId: checkpoint.missionId,
        missionState: checkpoint.missionState,
        currentStep: checkpoint.currentStep,
        version: checkpoint.version,
        nextAction: checkpoint.nextAction,
      },
      'Mission recovery checkpoint persisted',
    );
    return checkpoint;
  }

  async executeCriticalAction(
    input: ClaimActionInput,
    effect: () => Promise<CriticalActionEffectResult>,
  ): Promise<CriticalActionResult> {
    const claim = await this.repository.claimAction(input);
    assertIdentity(claim.action, input);
    if (claim.action.status === 'COMPLETED') return completedResult(claim.action);
    if (claim.action.status === 'IN_PROGRESS' || claim.action.status === 'UNCERTAIN') {
      throw recoveryError(
        'ACTION_RECONCILIATION_REQUIRED',
        'The action may already have produced a side effect and must be reconciled before resuming',
        {
          missionId: input.missionId,
          actionId: claim.action.actionId,
          status: claim.action.status,
        },
      );
    }
    if (claim.action.status === 'FAILED') {
      throw recoveryError(
        'ACTION_FAILED',
        'The action is durably failed and requires an explicit recovery decision',
        { missionId: input.missionId, actionId: claim.action.actionId },
      );
    }

    const begun = await this.repository.beginAction(claim.action.id);
    if (!begun.started) {
      if (begun.action.status === 'COMPLETED') return completedResult(begun.action);
      throw recoveryError(
        'ACTION_RECONCILIATION_REQUIRED',
        'Another request already claimed this critical action',
        { missionId: input.missionId, actionId: begun.action.actionId },
      );
    }
    this.logger.info(
      {
        event: 'recovery.action.started',
        missionId: input.missionId,
        actionId: input.actionId,
        paymentId: input.paymentId,
        kind: input.kind,
        attempt: begun.action.attempts,
      },
      'Critical action started from durable intent',
    );

    try {
      const result = await effect();
      const completed = await this.repository.completeAction(
        begun.action.id,
        result.receipt,
        result.providerReference,
      );
      this.logger.info(
        {
          event: 'recovery.action.completed',
          missionId: input.missionId,
          actionId: input.actionId,
          paymentId: input.paymentId,
          providerReference: result.providerReference,
        },
        'Critical action receipt persisted',
      );
      return { action: completed, receipt: result.receipt, deduplicated: false };
    } catch (error) {
      await this.repository.markActionUncertain(
        begun.action.id,
        'Execution ended without a durable completion receipt; provider reconciliation is required.',
      );
      throw recoveryError(
        'ACTION_OUTCOME_UNCERTAIN',
        'Critical action outcome is uncertain and will not be repeated automatically',
        { missionId: input.missionId, actionId: input.actionId },
        error,
      );
    }
  }

  async reconcileAction(
    missionId: string,
    actionId: string,
    reconcile: (action: RecoveryAction) => Promise<ReconciliationResult>,
  ): Promise<RecoveryAction> {
    const action = (await this.repository.listActions(missionId)).find(
      (candidate) => candidate.actionId === actionId,
    );
    if (!action) {
      throw new AppError({
        statusCode: 404,
        code: 'RECOVERY_ACTION_NOT_FOUND',
        message: `Recovery action not found: ${actionId}`,
      });
    }
    if (action.status === 'COMPLETED' || action.status === 'FAILED') return action;
    const result = await reconcile(action);
    if (result.status === 'PENDING') return action;
    if (result.status === 'FAILED') {
      return this.repository.markActionFailed(
        action.id,
        result.failureReason ?? 'Provider confirmed the action failed.',
      );
    }
    if (!result.receipt) {
      throw recoveryError(
        'RECONCILIATION_RECEIPT_REQUIRED',
        'Completed reconciliation requires a durable receipt',
        { missionId, actionId },
      );
    }
    return this.repository.completeAction(action.id, result.receipt, result.providerReference);
  }

  async recover(missionId: string): Promise<RecoveryPlan> {
    const checkpoint = await this.repository.findCheckpoint(missionId);
    if (!checkpoint) {
      throw new AppError({
        statusCode: 404,
        code: 'RECOVERY_CHECKPOINT_NOT_FOUND',
        message: `Recovery checkpoint not found for mission: ${missionId}`,
      });
    }
    const actions = await this.repository.listActions(missionId);
    assertRecoveryIntegrity(checkpoint, actions);
    const completed = actions.filter(({ status }) => status === 'COMPLETED');
    const ambiguous = actions.filter(
      ({ status }) => status === 'IN_PROGRESS' || status === 'UNCERTAIN',
    );
    const terminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(checkpoint.missionState);
    const mustNotRepeat = [
      ...new Set(
        actions
          .filter(({ status }) => ['COMPLETED', 'IN_PROGRESS', 'UNCERTAIN'].includes(status))
          .flatMap(({ actionId, paymentId }) => [
            `action:${actionId}`,
            ...(paymentId ? [`payment:${paymentId}`] : []),
          ]),
      ),
    ];
    const plan: RecoveryPlan = {
      checkpoint,
      actions,
      whatAlreadyHappened: completed.map(
        ({ actionId, providerReference }) =>
          `${actionId} completed${providerReference ? ` as ${providerReference}` : ''}`,
      ),
      whatRemains: terminal ? [] : [checkpoint.nextAction],
      mustNotRepeat,
      canSafelyResume: !terminal && ambiguous.length === 0,
      ...(terminal
        ? { blockingReason: `Mission is terminal in state ${checkpoint.missionState}.` }
        : ambiguous.length > 0
          ? {
              blockingReason: `Reconcile ambiguous actions before resume: ${ambiguous.map(({ actionId }) => actionId).join(', ')}.`,
            }
          : {}),
      nextAction: checkpoint.nextAction,
    };
    this.logger.info(
      {
        event: 'recovery.plan',
        missionId,
        checkpointVersion: checkpoint.version,
        completedActions: completed.length,
        ambiguousActions: ambiguous.length,
        canSafelyResume: plan.canSafelyResume,
        nextAction: plan.nextAction,
      },
      'Mission recovery plan created',
    );
    return plan;
  }

  async resume<T>(missionId: string, resume: (plan: RecoveryPlan) => Promise<T>): Promise<T> {
    const plan = await this.recover(missionId);
    if (!plan.canSafelyResume) {
      throw recoveryError(
        'MISSION_RESUME_BLOCKED',
        plan.blockingReason ?? 'Mission cannot safely resume',
        { missionId, nextAction: plan.nextAction },
      );
    }
    return resume(plan);
  }
}

export type RecoveryReceipt = JsonObject;
