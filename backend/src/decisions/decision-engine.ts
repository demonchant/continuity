import type { Agent } from '../agents/agent.js';
import { normalizeCapability } from '../agents/agent.js';
import type { AgentRegistry } from '../agents/agent-registry.js';
import {
  inferMissionCapabilities,
  MissionAgentCandidateService,
} from '../agents/mission-agent-candidates.js';
import { ExperienceEngine } from '../experience/experience-engine.js';
import { loadDecisionMemoryContext } from '../memory/decision-memory-context.js';
import type { MemoryService } from '../memory/memory-service.js';
import type { Mission } from '../missions/mission.js';
import { AppError } from '../shared/errors/app-error.js';
import type { AgentDecision, AgentDecisionEvidence, DecisionAlternative } from './decision.js';

interface DecisionEngineOptions {
  readonly now?: () => Date;
  readonly experienceEngine?: ExperienceEngine;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function numericCost(agent: Agent): number | null {
  if (agent.cost.model === 'FREE') return 0;
  if (agent.cost.amount === undefined) return null;
  const parsed = Number(agent.cost.amount);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function costScores(candidates: readonly Agent[]): ReadonlyMap<string, number> {
  const currencies = new Set(candidates.map(({ cost }) => cost.currency).filter(Boolean));
  const values = candidates.map((agent) => numericCost(agent));
  if (currencies.size > 1 || values.some((value) => value === null)) {
    return new Map(candidates.map(({ id }) => [id, 0.5]));
  }
  const numeric = values.filter((value): value is number => value !== null);
  const minimum = Math.min(...numeric);
  const maximum = Math.max(...numeric);
  if (minimum === maximum) return new Map(candidates.map(({ id }) => [id, 0.5]));
  return new Map(
    candidates.map((agent) => [
      agent.id,
      round(1 - ((numericCost(agent) ?? minimum) - minimum) / (maximum - minimum)),
    ]),
  );
}

function alternativeReason(evidence: AgentDecisionEvidence): string {
  if (evidence.metrics.observationCount === 0) {
    return `Score ${evidence.finalScore}; no relevant historical experience was recalled.`;
  }
  const failures = evidence.metrics.failurePatterns.reduce(
    (sum, pattern) => sum + pattern.count,
    0,
  );
  return `Score ${evidence.finalScore}; ${evidence.metrics.observationCount} relevant outcomes, reliability ${evidence.metrics.reliability}, ${failures} failures.`;
}

export class DecisionEngine {
  private readonly candidateService: MissionAgentCandidateService;
  private readonly experience: ExperienceEngine;
  private readonly now: () => Date;

  constructor(
    registry: AgentRegistry,
    private readonly memory: MemoryService,
    options: DecisionEngineOptions = {},
  ) {
    this.candidateService = new MissionAgentCandidateService(registry);
    this.experience = options.experienceEngine ?? new ExperienceEngine();
    this.now = options.now ?? (() => new Date());
  }

  async decide(
    mission: Pick<Mission, 'id' | 'objective'>,
    requiredCapabilities: readonly string[] = inferMissionCapabilities(mission.objective),
  ): Promise<AgentDecision> {
    return this.evaluate(mission, requiredCapabilities, true);
  }

  async preview(
    mission: Pick<Mission, 'id' | 'objective'>,
    requiredCapabilities: readonly string[] = inferMissionCapabilities(mission.objective),
  ): Promise<AgentDecision> {
    return this.evaluate(mission, requiredCapabilities, false);
  }

  private async evaluate(
    mission: Pick<Mission, 'id' | 'objective'>,
    requiredCapabilities: readonly string[],
    persistDecision: boolean,
  ): Promise<AgentDecision> {
    const normalizedCapabilities = requiredCapabilities.map(normalizeCapability);
    const { candidates } = this.candidateService.identify(mission, normalizedCapabilities);
    if (candidates.length === 0) {
      throw new AppError({
        statusCode: 422,
        code: 'NO_ELIGIBLE_AGENTS',
        message: 'No available agent satisfies every required capability',
        details: { missionId: mission.id, requiredCapabilities: normalizedCapabilities },
      });
    }

    const memoryContext = await loadDecisionMemoryContext(this.memory, {
      mission: mission.objective,
      capabilities: normalizedCapabilities,
      agentIds: candidates.map(({ id }) => id),
      categories: ['outcome', 'failure', 'experience'],
      limit: 50,
    });
    const recalled =
      memoryContext.historicalExperience === 'available' ? memoryContext.evidence : [];
    const costs = costScores(candidates);
    const evidence = candidates.map((agent): AgentDecisionEvidence => {
      const history = this.experience.evaluate({
        agentId: agent.id,
        capabilities: normalizedCapabilities,
        mission: mission.objective,
        memories: recalled,
        asOf: this.now(),
      });
      const costScore = costs.get(agent.id) ?? 0.5;
      return {
        agentId: agent.id,
        finalScore: round(history.historicalScore + 0.15 * costScore),
        historicalScore: history.historicalScore,
        costScore,
        metrics: {
          observationCount: history.observationCount,
          successRate: history.successRate,
          verificationSuccessRate: history.verificationSuccessRate,
          similarMissionOutcomes: history.similarMissionOutcomes,
          recentOutcomeRate: history.recentOutcomeRate,
          failurePatterns: history.failurePatterns,
          reliability: history.reliability,
          experienceConfidence: history.confidence,
        },
        capabilityProfiles: history.profiles,
        memoryReferences: history.memoryReferences,
      };
    });

    const ranked = candidates
      .map((agent) => ({ agent, evidence: evidence.find(({ agentId }) => agentId === agent.id)! }))
      .sort(
        (left, right) =>
          right.evidence.finalScore - left.evidence.finalScore ||
          left.agent.id.localeCompare(right.agent.id),
      );
    const selected = ranked[0]!;
    const runnerUp = ranked[1];
    const margin = runnerUp ? selected.evidence.finalScore - runnerUp.evidence.finalScore : 0.25;
    const confidence =
      memoryContext.historicalExperience === 'unavailable'
        ? 0.1
        : selected.evidence.metrics.observationCount === 0
          ? 0.25
          : round(
              Math.min(
                0.95,
                0.35 + selected.evidence.metrics.experienceConfidence * 0.45 + margin * 0.2,
              ),
            );
    const reason = this.explain(
      selected.agent,
      selected.evidence,
      runnerUp,
      memoryContext.historicalExperience,
    );
    const alternatives: DecisionAlternative[] = ranked
      .slice(1)
      .map(({ agent, evidence: item }) => ({
        agent,
        score: item.finalScore,
        reason: alternativeReason(item),
        memoryReferences: item.memoryReferences,
      }));
    const memoryReferences = [...new Set(evidence.flatMap((item) => item.memoryReferences))];

    let decisionMemoryId: string | undefined;
    if (persistDecision && memoryContext.historicalExperience === 'available') {
      const cost =
        selected.agent.cost.amount !== undefined && selected.agent.cost.currency !== undefined
          ? { amount: selected.agent.cost.amount, currency: selected.agent.cost.currency }
          : undefined;
      const decision = await this.memory.recordDecision({
        missionId: mission.id,
        mission: mission.objective,
        capability: normalizedCapabilities.join(','),
        agentId: selected.agent.id,
        agentProvider: selected.agent.provider,
        result: `Selected ${selected.agent.name}; candidate scores: ${ranked.map(({ agent, evidence: item }) => `${agent.id}=${item.finalScore}`).join(', ')}`,
        ...(cost ? { cost } : {}),
        decisionReason: reason,
        confidence,
        recommendation: `Use ${selected.agent.id} for this mission under the evaluated evidence.`,
        memoryReferences,
        decisionCandidates: ranked.map(({ agent, evidence: item }) => {
          const offering = agent.metadata.offering;
          const offeringName =
            offering && typeof offering === 'object' && !Array.isArray(offering)
              ? offering.name
              : undefined;
          const offeringId = agent.metadata.offeringId;
          const slaMinutes =
            offering && typeof offering === 'object' && !Array.isArray(offering)
              ? offering.slaMinutes
              : undefined;
          const compatibilityReasons = agent.metadata.compatibilityReasons;
          return {
            agentId: agent.id,
            name: agent.name,
            ...(typeof offeringName === 'string' ? { offeringName } : {}),
            ...(typeof offeringId === 'string' ? { offeringId } : {}),
            ...(typeof slaMinutes === 'number' ? { slaMinutes } : {}),
            capabilities: agent.capabilities,
            ...(agent.cost.amount && agent.cost.currency
              ? { price: { amount: agent.cost.amount, currency: agent.cost.currency } }
              : {}),
            ...(typeof agent.metadata.compatibilityScore === 'number'
              ? {
                  compatible: true,
                  compatibilityScore: agent.metadata.compatibilityScore,
                  ...(Array.isArray(compatibilityReasons) &&
                  compatibilityReasons.every((value) => typeof value === 'string')
                    ? { compatibilityReasons }
                    : {}),
                }
              : {}),
            observationCount: item.metrics.observationCount,
            successRate: item.metrics.successRate,
            verificationSuccessRate: item.metrics.verificationSuccessRate,
            failurePatterns: item.metrics.failurePatterns,
            historicalScore: item.historicalScore,
            costScore: item.costScore,
            finalScore: item.finalScore,
            memoryReferences: item.memoryReferences,
            selected: agent.id === selected.agent.id,
          };
        }),
        tags: ['memory-driven-decision'],
      });
      decisionMemoryId = decision.id;
    }

    return {
      selectedAgent: selected.agent,
      reason,
      confidence,
      evidence,
      alternatives,
      memoryReferences,
      historicalExperience: memoryContext.historicalExperience,
      ...(decisionMemoryId ? { decisionMemoryId } : {}),
    };
  }

  private explain(
    selectedAgent: Agent,
    selectedEvidence: AgentDecisionEvidence,
    runnerUp: { readonly agent: Agent; readonly evidence: AgentDecisionEvidence } | undefined,
    memoryStatus: 'available' | 'unavailable',
  ): string {
    if (memoryStatus === 'unavailable') {
      return `Selected ${selectedAgent.name} using capability, availability, and cost only; Sibyl historical experience was unavailable.`;
    }
    if (
      selectedEvidence.metrics.observationCount === 0 &&
      (!runnerUp || runnerUp.evidence.metrics.observationCount === 0)
    ) {
      return `No relevant historical experience existed, so there was no experience-based preference; ${selectedAgent.name} was selected by cost and deterministic tie-break.`;
    }
    if (selectedEvidence.metrics.observationCount === 0 && runnerUp) {
      const patterns = runnerUp.evidence.metrics.failurePatterns
        .map(({ reason, count }) => `${reason} (${count})`)
        .join(', ');
      return `Selected ${selectedAgent.name} because recalled Sibyl evidence penalized ${runnerUp.agent.name}. ${runnerUp.agent.name} is not recommended because it failed a comparable mission previously; its relevant failures were ${patterns || 'recorded failures'}. ${selectedAgent.name} retained neutral historical reliability and scored ${selectedEvidence.finalScore} versus ${runnerUp.evidence.finalScore}.`;
    }
    const verification = selectedEvidence.metrics.verificationSuccessRate;
    const comparison = runnerUp
      ? ` It scored ${selectedEvidence.finalScore} versus ${runnerUp.agent.name} at ${runnerUp.evidence.finalScore}.`
      : '';
    return `Selected ${selectedAgent.name} using ${selectedEvidence.metrics.observationCount} relevant Sibyl outcomes: reliability ${selectedEvidence.metrics.reliability}, success rate ${selectedEvidence.metrics.successRate ?? 'unknown'}, verification success ${verification ?? 'unknown'}.${comparison}`;
  }
}
