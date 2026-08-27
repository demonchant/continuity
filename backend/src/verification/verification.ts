import type { Agent } from '../agents/agent.js';
import type { MemoryCost } from '../memory/memory-record.js';
import type { Mission } from '../missions/mission.js';

export type VerificationOutputFormat = 'json' | 'object' | 'array' | 'text';

export interface VerificationSource {
  readonly url?: string;
  readonly title?: string;
  readonly reference?: string;
}

/** Provider-neutral result. An agent's claimedSuccess value is never a verifier input. */
export interface AgentResult {
  readonly output: unknown;
  readonly claimedSuccess?: boolean;
  readonly sources?: readonly (string | VerificationSource)[];
  readonly evidence?: readonly unknown[];
  readonly providerReference?: string;
  readonly cost?: MemoryCost;
  readonly latencyMs?: number;
}

export interface VerificationRequest {
  readonly mission: Pick<Mission, 'id' | 'objective' | 'constraints'>;
  readonly agent: Pick<Agent, 'id' | 'provider'>;
  readonly capability: string;
  readonly result: AgentResult;
}

export interface VerificationCheck {
  readonly requirement: string;
  readonly passed: boolean;
  readonly reason: string;
}

export interface VerificationReport {
  readonly id: string;
  readonly verifierVersion: string;
  readonly passed: boolean;
  /** A deterministic value in the inclusive range 0..1. */
  readonly score: number;
  readonly reasons: readonly string[];
  readonly failedRequirements: readonly string[];
  readonly checks: readonly VerificationCheck[];
  readonly memoryRecordId: string;
  /** Present for production MemoryService writes; proof/live scripts fail closed if absent. */
  readonly sibylRecordId?: string;
  readonly sibylEventId?: string;
}
