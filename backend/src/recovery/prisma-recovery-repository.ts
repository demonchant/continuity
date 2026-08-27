import {
  Prisma,
  RecoveryActionStatus as PrismaRecoveryActionStatus,
  type MissionCheckpoint as PrismaMissionCheckpoint,
  type PrismaClient,
  type RecoveryAction as PrismaRecoveryAction,
} from '@prisma/client';
import type { JsonObject } from '../missions/mission.js';
import type { RecoveryRepository } from './recovery-repository.js';
import type {
  ActionClaim,
  ActionStateSnapshot,
  BeginActionResult,
  ClaimActionInput,
  MissionCheckpoint,
  PaymentStateSnapshot,
  RecoveryAction,
  RecoveryInformation,
  SaveMissionCheckpointInput,
  VerificationStateSnapshot,
} from './recovery.js';

function jsonObject(value: Prisma.JsonValue, label: string): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}

function inputJson(value: JsonObject): Prisma.InputJsonObject {
  return value;
}

function toCheckpoint(record: PrismaMissionCheckpoint): MissionCheckpoint {
  return {
    missionId: record.missionId,
    missionState: record.missionState,
    currentStep: record.currentStep,
    ...(record.selectedAgentId ? { selectedAgentId: record.selectedAgentId } : {}),
    actionState: jsonObject(record.actionState, 'actionState') as ActionStateSnapshot,
    paymentState: jsonObject(record.paymentState, 'paymentState') as PaymentStateSnapshot,
    verificationState: jsonObject(
      record.verificationState,
      'verificationState',
    ) as VerificationStateSnapshot,
    recoveryInfo: jsonObject(record.recoveryInfo, 'recoveryInfo') as RecoveryInformation,
    nextAction: record.nextAction,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toAction(record: PrismaRecoveryAction): RecoveryAction {
  const receipt = record.receipt ? jsonObject(record.receipt, 'receipt') : undefined;
  return {
    id: record.id,
    missionId: record.missionId,
    actionId: record.actionId,
    ...(record.paymentId ? { paymentId: record.paymentId } : {}),
    kind: record.kind,
    status: record.status,
    attempts: record.attempts,
    ...(record.providerReference ? { providerReference: record.providerReference } : {}),
    ...(receipt ? { receipt } : {}),
    ...(record.failureReason ? { failureReason: record.failureReason } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.completedAt ? { completedAt: record.completedAt } : {}),
  };
}

export class PrismaRecoveryRepository implements RecoveryRepository {
  constructor(private readonly client: PrismaClient) {}

  async saveCheckpoint(input: SaveMissionCheckpointInput): Promise<MissionCheckpoint> {
    const record = await this.client.missionCheckpoint.upsert({
      where: { missionId: input.missionId },
      create: {
        missionId: input.missionId,
        missionState: input.missionState,
        currentStep: input.currentStep,
        ...(input.selectedAgentId ? { selectedAgentId: input.selectedAgentId } : {}),
        actionState: inputJson(input.actionState),
        paymentState: inputJson(input.paymentState),
        verificationState: inputJson(input.verificationState),
        recoveryInfo: inputJson(input.recoveryInfo),
        nextAction: input.nextAction,
      },
      update: {
        missionState: input.missionState,
        currentStep: input.currentStep,
        selectedAgentId: input.selectedAgentId ?? null,
        actionState: inputJson(input.actionState),
        paymentState: inputJson(input.paymentState),
        verificationState: inputJson(input.verificationState),
        recoveryInfo: inputJson(input.recoveryInfo),
        nextAction: input.nextAction,
        version: { increment: 1 },
      },
    });
    return toCheckpoint(record);
  }

  findCheckpoint(missionId: string): Promise<MissionCheckpoint | null> {
    return this.client.missionCheckpoint
      .findUnique({ where: { missionId } })
      .then((record) => (record ? toCheckpoint(record) : null));
  }

  async listActions(missionId: string): Promise<readonly RecoveryAction[]> {
    const records = await this.client.recoveryAction.findMany({
      where: { missionId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return records.map(toAction);
  }

  async claimAction(input: ClaimActionInput): Promise<ActionClaim> {
    const existingByAction = await this.client.recoveryAction.findUnique({
      where: { missionId_actionId: { missionId: input.missionId, actionId: input.actionId } },
    });
    if (existingByAction) {
      return { action: toAction(existingByAction), created: false, matchedBy: 'actionId' };
    }
    if (input.paymentId) {
      const existingByPayment = await this.client.recoveryAction.findUnique({
        where: { paymentId: input.paymentId },
      });
      if (existingByPayment) {
        return { action: toAction(existingByPayment), created: false, matchedBy: 'paymentId' };
      }
    }
    try {
      const created = await this.client.recoveryAction.create({
        data: {
          missionId: input.missionId,
          actionId: input.actionId,
          ...(input.paymentId ? { paymentId: input.paymentId } : {}),
          kind: input.kind,
        },
      });
      return { action: toAction(created), created: true, matchedBy: 'created' };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const raced = await this.findClaimAfterConflict(input);
      if (raced) return raced;
      throw error;
    }
  }

  async beginAction(id: string): Promise<BeginActionResult> {
    const updated = await this.client.recoveryAction.updateMany({
      where: { id, status: PrismaRecoveryActionStatus.INTENDED },
      data: {
        status: PrismaRecoveryActionStatus.IN_PROGRESS,
        attempts: { increment: 1 },
      },
    });
    const action = await this.client.recoveryAction.findUniqueOrThrow({ where: { id } });
    return { action: toAction(action), started: updated.count === 1 };
  }

  async completeAction(
    id: string,
    receipt: JsonObject,
    providerReference?: string,
  ): Promise<RecoveryAction> {
    const record = await this.client.recoveryAction.update({
      where: { id },
      data: {
        status: PrismaRecoveryActionStatus.COMPLETED,
        receipt: inputJson(receipt),
        providerReference: providerReference ?? null,
        failureReason: null,
        completedAt: new Date(),
      },
    });
    return toAction(record);
  }

  markActionUncertain(id: string, failureReason: string): Promise<RecoveryAction> {
    return this.updateFailure(id, PrismaRecoveryActionStatus.UNCERTAIN, failureReason);
  }

  markActionFailed(id: string, failureReason: string): Promise<RecoveryAction> {
    return this.updateFailure(id, PrismaRecoveryActionStatus.FAILED, failureReason);
  }

  private async updateFailure(
    id: string,
    status: typeof PrismaRecoveryActionStatus.FAILED | typeof PrismaRecoveryActionStatus.UNCERTAIN,
    failureReason: string,
  ): Promise<RecoveryAction> {
    const record = await this.client.recoveryAction.update({
      where: { id },
      data: { status, failureReason },
    });
    return toAction(record);
  }

  private async findClaimAfterConflict(input: ClaimActionInput): Promise<ActionClaim | null> {
    const action = await this.client.recoveryAction.findUnique({
      where: { missionId_actionId: { missionId: input.missionId, actionId: input.actionId } },
    });
    if (action) return { action: toAction(action), created: false, matchedBy: 'actionId' };
    if (!input.paymentId) return null;
    const payment = await this.client.recoveryAction.findUnique({
      where: { paymentId: input.paymentId },
    });
    return payment ? { action: toAction(payment), created: false, matchedBy: 'paymentId' } : null;
  }
}
