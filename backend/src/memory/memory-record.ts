import type { AcpEvidenceProvenance } from '../verification/evidence-hash.js';

export const memoryCategories = [
  'mission',
  'agent',
  'decision',
  'outcome',
  'failure',
  'experience',
  'recovery_checkpoint',
] as const;

export type MemoryCategory = (typeof memoryCategories)[number];

export interface MemoryCost {
  readonly amount: string;
  readonly currency: string;
}

export interface MemoryVerification {
  readonly status: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly summary: string;
  readonly verifierVersion?: string;
  readonly score?: number;
  readonly failedRequirements?: readonly string[];
}

export interface MemoryRecoverySnapshot {
  readonly missionState: string;
  readonly currentStep: string;
  readonly selectedAgentId?: string;
  readonly actionStatus: string;
  readonly paymentStatus: string;
  readonly verificationStatus: string;
  readonly nextAction: string;
}

export interface MemoryDecisionCandidate {
  readonly agentId: string;
  readonly name: string;
  readonly offeringName?: string;
  readonly offeringId?: string;
  readonly slaMinutes?: number;
  readonly capabilities: readonly string[];
  readonly price?: MemoryCost;
  readonly compatible?: boolean;
  readonly compatibilityScore?: number;
  readonly compatibilityReasons?: readonly string[];
  readonly observationCount: number;
  readonly successRate: number | null;
  readonly verificationSuccessRate: number | null;
  readonly failurePatterns: readonly { readonly reason: string; readonly count: number }[];
  readonly historicalScore: number;
  readonly costScore: number;
  readonly finalScore: number;
  readonly memoryReferences: readonly string[];
  readonly selected: boolean;
}

/**
 * Application-owned record persisted as a WARM Sibyl entity. Keep this shape
 * provider-neutral: the Sibyl adapter is the only code that knows MCP payloads.
 */
export interface MemoryRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly category: MemoryCategory;
  readonly timestamp: string;
  readonly missionId: string;
  /** Tenant boundary for customer-owned missions. Absent only for legacy/operator missions. */
  readonly organizationId?: string;
  readonly mission: string;
  readonly capability: string;
  readonly agentId?: string;
  readonly agentProvider?: string;
  readonly result?: string;
  readonly verification?: MemoryVerification;
  readonly cost?: MemoryCost;
  readonly latencyMs?: number;
  readonly success?: boolean;
  readonly failureReason?: string;
  readonly decisionReason?: string;
  readonly confidence?: number;
  readonly recommendation?: string;
  readonly providerReference?: string;
  readonly evidenceHash?: string;
  readonly provenance?: AcpEvidenceProvenance;
  readonly tags?: readonly string[];
  readonly memoryReferences?: readonly string[];
  readonly decisionCandidates?: readonly MemoryDecisionCandidate[];
  readonly recovery?: MemoryRecoverySnapshot;
}

export type NewMemoryRecord = Omit<MemoryRecord, 'schemaVersion' | 'id' | 'timestamp'> &
  Partial<Pick<MemoryRecord, 'id' | 'timestamp'>>;

export interface MemoryQuery {
  readonly mission: string;
  /** When present, recall must return records owned by this organization only. */
  readonly organizationId?: string;
  readonly capabilities: readonly string[];
  readonly agentIds?: readonly string[];
  readonly tags?: readonly string[];
  readonly categories?: readonly MemoryCategory[];
  readonly limit?: number;
}

export interface RecalledMemory {
  readonly record: MemoryRecord;
  readonly sibylRecordId: string;
  readonly sibylTier: string;
  readonly relevance?: number;
}

export interface MemoryRecallResult {
  readonly provider: 'sibyl';
  readonly query: string;
  readonly records: readonly RecalledMemory[];
}

/** Provider acknowledgements returned only after both durable writes succeed. */
export interface MemoryWriteReceipt {
  readonly record: MemoryRecord;
  readonly sibylRecordId: string;
  readonly sibylEventId?: string;
}

export interface RecoveryCheckpointInput extends NewMemoryRecord {
  readonly category: 'recovery_checkpoint';
  readonly state: string;
  readonly nextAction: string;
}
