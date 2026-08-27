import type { JsonObject, MissionStatus } from '../missions/mission.js';

export const recoveryActionStatuses = [
  'INTENDED',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'UNCERTAIN',
] as const;
export type RecoveryActionStatus = (typeof recoveryActionStatuses)[number];

export interface ActionStateSnapshot extends JsonObject {
  readonly actionId?: string;
  readonly status: 'NOT_STARTED' | RecoveryActionStatus;
}

export interface PaymentStateSnapshot extends JsonObject {
  readonly paymentId?: string;
  readonly status: 'NOT_APPLICABLE' | 'NOT_STARTED' | RecoveryActionStatus;
}

export interface VerificationStateSnapshot extends JsonObject {
  readonly status: 'NOT_STARTED' | 'PENDING' | 'PASS' | 'FAIL';
  readonly reportId?: string;
}

export interface RecoveryInformation extends JsonObject {
  readonly interrupted: boolean;
  readonly reason?: string;
  readonly resumeFrom?: string;
}

export interface MissionCheckpoint {
  readonly missionId: string;
  readonly missionState: MissionStatus;
  readonly currentStep: string;
  readonly selectedAgentId?: string;
  readonly actionState: ActionStateSnapshot;
  readonly paymentState: PaymentStateSnapshot;
  readonly verificationState: VerificationStateSnapshot;
  readonly recoveryInfo: RecoveryInformation;
  readonly nextAction: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SaveMissionCheckpointInput {
  readonly missionId: string;
  readonly mission: string;
  readonly capability: string;
  readonly missionState: MissionStatus;
  readonly currentStep: string;
  readonly selectedAgentId?: string;
  readonly actionState: ActionStateSnapshot;
  readonly paymentState: PaymentStateSnapshot;
  readonly verificationState: VerificationStateSnapshot;
  readonly recoveryInfo: RecoveryInformation;
  readonly nextAction: string;
}

export interface RecoveryAction {
  readonly id: string;
  readonly missionId: string;
  readonly actionId: string;
  readonly paymentId?: string;
  readonly kind: string;
  readonly status: RecoveryActionStatus;
  readonly attempts: number;
  readonly providerReference?: string;
  readonly receipt?: JsonObject;
  readonly failureReason?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt?: Date;
}

export interface ClaimActionInput {
  readonly missionId: string;
  readonly actionId: string;
  readonly paymentId?: string;
  readonly kind: string;
}

export interface ActionClaim {
  readonly action: RecoveryAction;
  readonly created: boolean;
  readonly matchedBy: 'created' | 'actionId' | 'paymentId';
}

export interface BeginActionResult {
  readonly action: RecoveryAction;
  readonly started: boolean;
}

export interface CriticalActionEffectResult {
  readonly receipt: JsonObject;
  readonly providerReference?: string;
}

export interface CriticalActionResult {
  readonly action: RecoveryAction;
  readonly receipt: JsonObject;
  readonly deduplicated: boolean;
}

export interface ReconciliationResult {
  readonly status: 'COMPLETED' | 'FAILED' | 'PENDING';
  readonly receipt?: JsonObject;
  readonly providerReference?: string;
  readonly failureReason?: string;
}

export interface RecoveryPlan {
  readonly checkpoint: MissionCheckpoint;
  readonly actions: readonly RecoveryAction[];
  readonly whatAlreadyHappened: readonly string[];
  readonly whatRemains: readonly string[];
  readonly mustNotRepeat: readonly string[];
  readonly canSafelyResume: boolean;
  readonly blockingReason?: string;
  readonly nextAction: string;
}
