export const missionStatuses = [
  'CREATED',
  'QUEUED',
  'PLANNING',
  'SELECTING_AGENT',
  'EXECUTING',
  'AWAITING_FUNDING_APPROVAL',
  'VERIFYING',
  'AWAITING_BASE_APPROVAL',
  'COMPLETED',
  'FAILED',
  'RECOVERING',
  'CANCELLED',
] as const;

export type MissionStatus = (typeof missionStatuses)[number];

export function isMissionStatus(value: unknown): value is MissionStatus {
  return typeof value === 'string' && (missionStatuses as readonly string[]).includes(value);
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export interface Mission {
  readonly id: string;
  readonly organizationId?: string;
  readonly objective: string;
  readonly constraints: JsonObject;
  readonly budget: string;
  readonly status: MissionStatus;
  readonly currentStep: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly recoveryState?: string;
  readonly lastHeartbeat?: Date;
  readonly lastReconciliation?: Date;
  readonly recoveryFailureReason?: string;
}

export interface CreateMissionInput {
  readonly organizationId?: string;
  readonly objective: string;
  readonly constraints: JsonObject;
  readonly budget: string;
}

export interface MissionTransitionInput {
  readonly missionId: string;
  readonly expectedStatus: MissionStatus;
  readonly targetStatus: MissionStatus;
  readonly currentStep: string;
  readonly reason?: string;
}
