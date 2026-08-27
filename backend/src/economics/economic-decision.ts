import type { Agent } from '../agents/agent.js';
import type { AgentHistoricalMetrics, DecisionAlternative } from '../decisions/decision.js';
import type { BaseTransaction } from '../integrations/base/base-transaction.js';

export interface EconomicHistoricalEvidence {
  readonly agentId: string;
  readonly metrics: AgentHistoricalMetrics;
  readonly memoryReferences: readonly string[];
}

export interface ExpectedOutcome {
  readonly description: string;
  readonly verifiedSuccessProbability: number;
  readonly expectedCostPerVerifiedSuccess?: string;
}

export interface EconomicDecision {
  readonly selectedAgent: Agent;
  readonly expectedOutcome: ExpectedOutcome;
  readonly estimatedCost: { readonly amount: string; readonly currency: string };
  readonly historicalEvidence: readonly EconomicHistoricalEvidence[];
  readonly reason: string;
  readonly confidence: number;
  readonly alternatives: readonly DecisionAlternative[];
  readonly memoryReferences: readonly string[];
  readonly historicalExperience: 'available' | 'unavailable';
  readonly decisionMemoryId?: string;
}

export interface EconomicExecutionResult {
  readonly decision: EconomicDecision;
  readonly baseAction:
    | { readonly status: 'NOT_REQUESTED' }
    | { readonly status: 'CONFIRMED'; readonly transaction: BaseTransaction };
}
