import type { Agent } from '../agents/agent.js';
import type { CapabilityExperienceProfile } from '../experience/experience.js';

export interface AgentHistoricalMetrics {
  readonly observationCount: number;
  readonly successRate: number | null;
  readonly verificationSuccessRate: number | null;
  readonly similarMissionOutcomes: number;
  readonly recentOutcomeRate: number | null;
  readonly failurePatterns: readonly { readonly reason: string; readonly count: number }[];
  readonly reliability: number;
  readonly experienceConfidence: number;
}

export interface AgentDecisionEvidence {
  readonly agentId: string;
  readonly finalScore: number;
  readonly historicalScore: number;
  readonly costScore: number;
  readonly metrics: AgentHistoricalMetrics;
  readonly capabilityProfiles: readonly CapabilityExperienceProfile[];
  readonly memoryReferences: readonly string[];
}

export interface DecisionAlternative {
  readonly agent: Agent;
  readonly score: number;
  readonly reason: string;
  readonly memoryReferences: readonly string[];
}

export interface AgentDecision {
  readonly selectedAgent: Agent;
  readonly reason: string;
  readonly confidence: number;
  readonly evidence: readonly AgentDecisionEvidence[];
  readonly alternatives: readonly DecisionAlternative[];
  readonly memoryReferences: readonly string[];
  readonly historicalExperience: 'available' | 'unavailable';
  readonly decisionMemoryId?: string;
}
