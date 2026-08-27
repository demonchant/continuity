export interface ExperienceCost {
  readonly amount: string;
  readonly currency: string;
}

export interface ExperienceFailurePattern {
  readonly reason: string;
  readonly count: number;
}

/** Operational knowledge for one agent doing one capability. */
export interface CapabilityExperienceProfile {
  readonly agentId: string;
  readonly capability: string;
  readonly observationCount: number;
  readonly effectiveSampleSize: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly successRate: number | null;
  readonly verificationSuccessRate: number | null;
  readonly reliability: number;
  readonly historicalScore: number;
  readonly confidence: number;
  readonly similarMissionOutcomes: number;
  readonly similarMissionSuccessRate: number | null;
  readonly recentOutcomeRate: number | null;
  readonly staleObservationCount: number;
  readonly averageCost: ExperienceCost | null;
  readonly averageLatencyMs: number | null;
  readonly failurePatterns: readonly ExperienceFailurePattern[];
  readonly observedFrom: string | null;
  readonly observedTo: string | null;
  readonly recommendation: string;
  readonly memoryReferences: readonly string[];
}

export interface AgentExperienceEvaluation {
  readonly profiles: readonly CapabilityExperienceProfile[];
  readonly historicalScore: number;
  readonly observationCount: number;
  readonly successRate: number | null;
  readonly verificationSuccessRate: number | null;
  readonly similarMissionOutcomes: number;
  readonly recentOutcomeRate: number | null;
  readonly failurePatterns: readonly ExperienceFailurePattern[];
  readonly reliability: number;
  readonly confidence: number;
  readonly memoryReferences: readonly string[];
}

export interface ExperienceQuery {
  readonly agentId: string;
  readonly capabilities: readonly string[];
  readonly mission: string;
  readonly memories: readonly RecalledMemory[];
  readonly asOf?: Date;
}
import type { RecalledMemory } from '../memory/memory-record.js';
