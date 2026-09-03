import type { JsonObject } from '../../missions/mission.js';
import type { AcpEvidenceProvenance } from '../../verification/evidence-hash.js';

export const persistedVirtualsJobStates = [
  'CREATED',
  'OPEN',
  'BUDGET_PROPOSED',
  'AWAITING_FUNDING_APPROVAL',
  'FUNDED',
  'SUBMITTED',
  'COMPLETED',
  'REJECTED',
  'EXPIRED',
  'UNCERTAIN',
  'FAILED',
] as const;
export type PersistedVirtualsJobState = (typeof persistedVirtualsJobStates)[number];

export interface VirtualsJob {
  readonly id: string;
  readonly missionId: string;
  readonly actionId: string;
  readonly externalJobId: string;
  readonly chainId: number;
  readonly agentId: string;
  readonly providerAddress: string;
  readonly offeringName: string;
  readonly state: PersistedVirtualsJobState;
  readonly requirement: JsonObject;
  readonly result?: JsonObject;
  readonly verification?: JsonObject;
  readonly lifecycle?: JsonObject;
  readonly evidenceHash?: string;
  readonly provenance?: AcpEvidenceProvenance;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt?: Date;
}

export type CreateVirtualsJobInput = Pick<
  VirtualsJob,
  | 'missionId'
  | 'actionId'
  | 'externalJobId'
  | 'chainId'
  | 'agentId'
  | 'providerAddress'
  | 'offeringName'
  | 'requirement'
>;

export interface UpdateVirtualsJobInput {
  readonly id: string;
  readonly state: PersistedVirtualsJobState;
  readonly result?: JsonObject;
  readonly verification?: JsonObject;
  readonly lifecycle?: JsonObject;
  readonly evidenceHash?: string;
  readonly provenance?: AcpEvidenceProvenance;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}
