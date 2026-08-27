import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { LocalTestAgent } from '../agents/agent.js';
import { InMemoryAgentRegistry } from '../agents/agent-registry.js';
import { DecisionEngine } from '../decisions/decision-engine.js';
import type { AgentDecision } from '../decisions/decision.js';
import type { MemoryService } from '../memory/memory-service.js';
import type {
  CreateMissionInput,
  JsonObject,
  Mission,
  MissionTransitionInput,
} from '../missions/mission.js';
import type { MissionRepository } from '../missions/mission-repository.js';
import { MissionService } from '../missions/mission-service.js';
import type { VerificationReport } from '../verification/verification.js';
import { VerificationService } from '../verification/verification-service.js';

export const freshSessionObjective =
  'Research and verify the official Base documentation for transaction finality';

const constraints: JsonObject = {
  output: { format: 'object', requiredFields: ['summary', 'sources'] },
  requiredSources: 2,
  requireEvidence: true,
};

export interface FreshSessionResult {
  readonly mission: Mission;
  readonly decision: AgentDecision;
  readonly verification: VerificationReport;
}

export interface FreshSessionDemoObserver {
  missionCreated?(mission: Mission): void;
  decisionCompleted?(mission: Mission, decision: AgentDecision): void;
  agentResultReceived?(mission: Mission, agent: LocalTestAgent, resultSummary: string): void;
  verificationCompleted?(
    mission: Mission,
    decision: AgentDecision,
    verification: VerificationReport,
  ): void;
}

/** Missions deliberately live only for one application process in this demo. */
class SessionMissionRepository implements MissionRepository {
  private readonly missions = new Map<string, Mission>();

  create(input: CreateMissionInput): Promise<Mission> {
    const now = new Date();
    const mission: Mission = {
      id: randomUUID(),
      objective: input.objective,
      constraints: input.constraints,
      budget: input.budget,
      status: 'CREATED',
      currentStep: 'created',
      createdAt: now,
      updatedAt: now,
    };
    this.missions.set(mission.id, mission);
    return Promise.resolve(mission);
  }

  findAll(): Promise<readonly Mission[]> {
    return Promise.resolve([...this.missions.values()]);
  }

  findById(id: string): Promise<Mission | null> {
    return Promise.resolve(this.missions.get(id) ?? null);
  }

  transition(input: MissionTransitionInput): Promise<Mission | null> {
    const mission = this.missions.get(input.missionId);
    if (!mission || mission.status !== input.expectedStatus) return Promise.resolve(null);
    const updated: Mission = {
      ...mission,
      status: input.targetStatus,
      currentStep: input.currentStep,
      updatedAt: new Date(),
    };
    this.missions.set(updated.id, updated);
    return Promise.resolve(updated);
  }
}

function safeRunId(runId: string): string {
  const normalized = runId.trim().toLowerCase();
  if (!/^[a-z0-9-]{6,40}$/.test(normalized)) {
    throw new Error(
      'CONTINUITY_DEMO_RUN_ID must contain 6-40 lowercase letters, digits, or dashes',
    );
  }
  return normalized;
}

export function freshSessionAgents(runId: string): readonly [LocalTestAgent, LocalTestAgent] {
  const scope = safeRunId(runId);
  const capability = freshSessionCapability(scope);
  return [
    {
      id: `phase16-agent-a-${scope}`,
      name: '[LOCAL TEST] Agent A',
      source: 'LOCAL_TEST',
      provider: 'local-test',
      capabilities: [capability],
      status: 'AVAILABLE',
      cost: { model: 'FIXED', amount: '0.10', currency: 'USD' },
      metadata: { phase: 16, role: 'deterministic-demo-candidate' },
    },
    {
      id: `phase16-agent-b-${scope}`,
      name: '[LOCAL TEST] Agent B',
      source: 'LOCAL_TEST',
      provider: 'local-test',
      capabilities: [capability],
      status: 'AVAILABLE',
      cost: { model: 'FIXED', amount: '0.50', currency: 'USD' },
      metadata: { phase: 16, role: 'deterministic-demo-candidate' },
    },
  ];
}

/** A single FTS-safe capability makes the cross-process recall key unambiguous. */
export function freshSessionCapability(runId: string): string {
  return `phase16verification${safeRunId(runId).replaceAll('-', '')}`;
}

function registry(runId: string): InMemoryAgentRegistry {
  const result = new InMemoryAgentRegistry();
  for (const agent of freshSessionAgents(runId)) result.register(agent);
  return result;
}

async function mission(): Promise<Mission> {
  return new MissionService(new SessionMissionRepository()).create({
    objective: freshSessionObjective,
    constraints,
    budget: '1.00',
  });
}

/**
 * Runs the two halves of the Phase 16 proof. A caller must construct a new
 * instance, MemoryService, and OS process for each session.
 */
export class FreshSessionRecallDemo {
  constructor(
    private readonly runId: string,
    private readonly memory: MemoryService,
    private readonly logger: Logger,
    private readonly observer: FreshSessionDemoObserver = {},
  ) {
    safeRunId(runId);
  }

  async sessionA(): Promise<FreshSessionResult> {
    const created = await mission();
    this.observer.missionCreated?.(created);
    const decision = await new DecisionEngine(registry(this.runId), this.memory).decide(created, [
      freshSessionCapability(this.runId),
    ]);
    const [agentA] = freshSessionAgents(this.runId);
    if (decision.selectedAgent.id !== agentA.id || decision.memoryReferences.length !== 0) {
      throw new Error('Session A was not clean: use a new CONTINUITY_DEMO_RUN_ID before recording');
    }
    this.observer.decisionCompleted?.(created, decision);
    this.observer.agentResultReceived?.(
      created,
      agentA,
      'Agent A claimed completion but omitted summary, sources, and evidence.',
    );

    // Agent A claims success, but its actual output omits the required summary,
    // sources, and evidence. The real verifier—not this harness—creates failure memory.
    const verification = await new VerificationService(this.memory, this.logger).verify({
      mission: created,
      agent: decision.selectedAgent,
      capability: freshSessionCapability(this.runId),
      result: {
        output: { status: 'completed', success: true, note: 'Research finished.' },
        claimedSuccess: true,
        providerReference: `phase16-session-a-${this.runId}`,
        cost: { amount: '0.10', currency: 'USD' },
        latencyMs: 125,
      },
    });
    if (verification.passed) throw new Error('Session A unexpectedly passed verification');
    this.observer.verificationCompleted?.(created, decision, verification);
    return { mission: created, decision, verification };
  }

  async sessionB(): Promise<FreshSessionResult> {
    const created = await mission();
    this.observer.missionCreated?.(created);
    const decision = await new DecisionEngine(registry(this.runId), this.memory).decide(created, [
      freshSessionCapability(this.runId),
    ]);
    const [agentA, agentB] = freshSessionAgents(this.runId);
    const failedAgentEvidence = decision.evidence.find(({ agentId }) => agentId === agentA.id);
    if (
      decision.selectedAgent.id !== agentB.id ||
      decision.memoryReferences.length === 0 ||
      (failedAgentEvidence?.metrics.observationCount ?? 0) === 0
    ) {
      throw new Error('Session B did not recall Agent A failure from Sibyl and select Agent B');
    }
    this.observer.decisionCompleted?.(created, decision);
    this.observer.agentResultReceived?.(
      created,
      agentB,
      'Agent B returned the required summary, two official sources, and supporting evidence.',
    );

    const verification = await new VerificationService(this.memory, this.logger).verify({
      mission: created,
      agent: decision.selectedAgent,
      capability: freshSessionCapability(this.runId),
      result: {
        output: {
          status: 'completed',
          success: true,
          summary:
            'Base transaction finality was researched and verified against official sources.',
          sources: [
            { title: 'Base documentation', url: 'https://docs.base.org/' },
            {
              title: 'Base network information',
              url: 'https://docs.base.org/base-chain/network-information',
            },
          ],
          evidence: ['Two official Base documentation references support the summary.'],
        },
        claimedSuccess: true,
        providerReference: `phase16-session-b-${this.runId}`,
        cost: { amount: '0.50', currency: 'USD' },
        latencyMs: 150,
      },
    });
    if (!verification.passed) throw new Error('Session B unexpectedly failed verification');
    this.observer.verificationCompleted?.(created, decision, verification);
    return { mission: created, decision, verification };
  }
}
