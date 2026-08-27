import type { Logger } from 'pino';
import type { Agent } from '../agents/agent.js';
import { InMemoryAgentRegistry } from '../agents/agent-registry.js';
import { DecisionEngine } from '../decisions/decision-engine.js';
import type { AgentDecisionEvidence } from '../decisions/decision.js';
import type { MemoryService } from '../memory/memory-service.js';
import type { Mission } from '../missions/mission.js';
import { AppError } from '../shared/errors/app-error.js';
import type { EconomicDecision, ExpectedOutcome } from './economic-decision.js';

function monetaryCost(agent: Agent, currency: string): number | null {
  if (agent.cost.model === 'FREE') return 0;
  if (agent.cost.currency?.toUpperCase() !== currency.toUpperCase() || !agent.cost.amount)
    return null;
  const value = Number(agent.cost.amount);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function outcome(evidence: AgentDecisionEvidence, cost: number): ExpectedOutcome {
  const probability =
    evidence.metrics.observationCount === 0
      ? 0.5
      : round(
          (evidence.metrics.reliability +
            (evidence.metrics.verificationSuccessRate ?? evidence.metrics.reliability)) /
            2,
        );
  return {
    description:
      evidence.metrics.observationCount === 0
        ? 'No comparable verified history; outcome estimate uses the neutral prior.'
        : `Estimated verified completion probability from ${evidence.metrics.observationCount} comparable Sibyl observations.`,
    verifiedSuccessProbability: probability,
    ...(probability > 0 ? { expectedCostPerVerifiedSuccess: (cost / probability).toFixed(4) } : {}),
  };
}

export class EconomicDecisionService {
  constructor(
    private readonly memory: MemoryService,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async decide(input: {
    readonly mission: Pick<Mission, 'id' | 'objective' | 'budget'>;
    readonly candidates: readonly Agent[];
    readonly capabilities: readonly string[];
    readonly budgetCurrency: string;
  }): Promise<EconomicDecision> {
    const budget = Number(input.mission.budget);
    if (!Number.isFinite(budget) || budget < 0) {
      throw new AppError({
        statusCode: 422,
        code: 'INVALID_ECONOMIC_BUDGET',
        message: 'Mission budget must be a non-negative decimal amount',
      });
    }
    const eligible = input.candidates.filter((agent) => {
      const cost = monetaryCost(agent, input.budgetCurrency);
      return cost !== null && cost <= budget;
    });
    if (eligible.length === 0) {
      throw new AppError({
        statusCode: 422,
        code: 'NO_ECONOMICALLY_ELIGIBLE_AGENTS',
        message: `No available candidate fits the ${input.mission.budget} ${input.budgetCurrency} budget`,
      });
    }
    const registry = new InMemoryAgentRegistry();
    for (const agent of eligible) if (!registry.get(agent.id)) registry.register(agent);
    const agentDecision = await new DecisionEngine(registry, this.memory, {
      now: this.now,
    }).decide(input.mission, input.capabilities);
    const selectedEvidence = agentDecision.evidence.find(
      ({ agentId }) => agentId === agentDecision.selectedAgent.id,
    )!;
    const selectedCost = monetaryCost(agentDecision.selectedAgent, input.budgetCurrency)!;
    const expectedOutcome = outcome(selectedEvidence, selectedCost);
    const estimatedCost = {
      amount: agentDecision.selectedAgent.cost.amount ?? '0',
      currency: input.budgetCurrency.toUpperCase(),
    };
    const reason = `${agentDecision.reason} Estimated cost ${estimatedCost.amount} ${estimatedCost.currency} is within the ${input.mission.budget} ${estimatedCost.currency} budget; expected verified-success probability is ${expectedOutcome.verifiedSuccessProbability}.`;
    const historicalEvidence = agentDecision.evidence.map(
      ({ agentId, metrics, memoryReferences }) => ({ agentId, metrics, memoryReferences }),
    );

    this.logger.info(
      {
        event: 'economic.memory.evidence',
        missionId: input.mission.id,
        candidateCount: eligible.length,
        historicalExperience: agentDecision.historicalExperience,
        memoryReferences: agentDecision.memoryReferences,
      },
      'Sibyl evidence loaded for economic decision',
    );
    this.logger.info(
      {
        event: 'economic.decision',
        missionId: input.mission.id,
        selectedAgentId: agentDecision.selectedAgent.id,
        estimatedCost,
        expectedOutcome,
        memoryReferences: agentDecision.memoryReferences,
      },
      'Memory-driven economic decision selected an agent',
    );
    return {
      selectedAgent: agentDecision.selectedAgent,
      expectedOutcome,
      estimatedCost,
      historicalEvidence,
      reason,
      confidence: agentDecision.confidence,
      alternatives: agentDecision.alternatives,
      memoryReferences: agentDecision.memoryReferences,
      historicalExperience: agentDecision.historicalExperience,
      ...(agentDecision.decisionMemoryId
        ? { decisionMemoryId: agentDecision.decisionMemoryId }
        : {}),
    };
  }
}
