import type { Logger } from 'pino';
import { InMemoryAgentRegistry } from '../../agents/agent-registry.js';
import { DecisionEngine } from '../../decisions/decision-engine.js';
import type { AgentDecision } from '../../decisions/decision.js';
import type { MemoryService } from '../../memory/memory-service.js';
import type { JsonObject, JsonValue, Mission } from '../../missions/mission.js';
import type { RecoveryService } from '../../recovery/recovery-service.js';
import type { VerificationReport } from '../../verification/verification.js';
import type { VerificationService } from '../../verification/verification-service.js';
import type {
  VirtualsAgentCandidate,
  VirtualsAgentSource,
  VirtualsJobSnapshot,
} from './virtuals-agent-source.js';
import { VirtualsProtocolError } from './virtuals-errors.js';
import type { VirtualsJobRepository } from './virtuals-job-repository.js';
import type { VirtualsJob } from './virtuals-job.js';

export interface ExecuteVirtualsMissionRequest {
  readonly mission: Pick<Mission, 'id' | 'objective' | 'constraints' | 'budget'>;
  readonly actionId: string;
  readonly capabilities: readonly string[];
  readonly requirements: JsonObject;
  readonly candidateLimit?: number;
  readonly excludedAgentIds?: readonly string[];
  readonly budgetCurrency?: string;
  readonly timeoutMs?: number;
}

export interface VirtualsExecutionResult {
  readonly decision: AgentDecision;
  readonly job: VirtualsJob;
  readonly verification: VerificationReport;
  readonly cost?: { readonly amount: string; readonly currency: string };
  readonly lifecycle: {
    readonly observedStates: readonly string[];
    readonly initialState: 'CREATED';
    readonly fundingState: 'NOT_REQUIRED' | 'FUNDED';
    readonly settlementState: 'COMPLETED' | 'REJECTED';
    readonly proposedBudget?: { readonly amount: string; readonly currency: string };
    readonly deliverable?: JsonValue;
  };
}

export interface VirtualsExecutionOptions {
  readonly maxJobUsdc: number;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) =>
        item === undefined ? [] : [[key, jsonValue(item)]],
      ),
    );
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.description ?? 'symbol';
  if (typeof value === 'function') return '[function]';
  return 'undefined';
}

function asObject(value: unknown): JsonObject {
  const normalized = jsonValue(value);
  return typeof normalized === 'object' && normalized !== null && !Array.isArray(normalized)
    ? normalized
    : { value: normalized };
}

function candidateFor(
  candidates: readonly VirtualsAgentCandidate[],
  agentId: string,
): VirtualsAgentCandidate {
  const candidate = candidates.find(({ agent }) => agent.id === agentId);
  if (!candidate) {
    throw new VirtualsProtocolError(
      'VIRTUALS_PROVIDER_ERROR',
      `Selected agent has no Virtuals execution candidate: ${agentId}`,
      false,
    );
  }
  return candidate;
}

function positiveAmount(value: string): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export class VirtualsExecutionService {
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly source: VirtualsAgentSource,
    private readonly jobs: VirtualsJobRepository,
    private readonly memory: MemoryService,
    private readonly recovery: RecoveryService,
    private readonly verification: VerificationService,
    private readonly logger: Logger,
    private readonly options: VirtualsExecutionOptions,
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.timeoutMs = options.timeoutMs ?? 15 * 60_000;
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async execute(request: ExecuteVirtualsMissionRequest): Promise<VirtualsExecutionResult> {
    const existingJob = await this.jobs.findByMissionAndAction(
      request.mission.id,
      request.actionId,
    );
    const discovered = await this.source.discoverCandidates({
      missionObjective: request.mission.objective,
      capabilities: request.capabilities,
      ...(request.candidateLimit ? { limit: request.candidateLimit } : {}),
    });
    const excluded = new Set(request.excludedAgentIds ?? []);
    const missionBudget = positiveAmount(request.mission.budget);
    const candidates = discovered.filter((candidate) => {
      const { agent } = candidate;
      if (
        existingJob &&
        (agent.id !== existingJob.agentId || candidate.offeringName !== existingJob.offeringName)
      )
        return false;
      if (excluded.has(agent.id)) return false;
      if (!agent.cost.amount) return true;
      const advertisedCost = positiveAmount(agent.cost.amount);
      const sameCurrency =
        !request.budgetCurrency ||
        !agent.cost.currency ||
        agent.cost.currency.toUpperCase() === request.budgetCurrency.toUpperCase();
      return (
        advertisedCost !== null &&
        missionBudget !== null &&
        advertisedCost <= missionBudget &&
        sameCurrency
      );
    });
    if (candidates.length === 0) {
      throw new VirtualsProtocolError(
        'VIRTUALS_NO_OFFERING',
        existingJob
          ? 'The persisted ACP job provider/offering was not returned by live discovery; recovery will not substitute a different agent'
          : 'No executable public Virtuals ACP offering was found',
        true,
      );
    }

    const registry = new InMemoryAgentRegistry();
    for (const { agent } of candidates) if (!registry.get(agent.id)) registry.register(agent);
    const decision = await new DecisionEngine(registry, this.memory).decide(
      request.mission,
      request.capabilities,
    );
    const candidate = candidateFor(candidates, decision.selectedAgent.id);

    let job: VirtualsJob | undefined;
    const observedStates: string[] = [];
    let proposedBudget: VirtualsJobSnapshot['budget'];
    let fundingState: 'NOT_REQUIRED' | 'FUNDED' = 'NOT_REQUIRED';
    try {
      job = await this.createOrRecoverJob(request, candidate);
      observedStates.push(job.state);
      const continuityJobId = job.id;
      const snapshot = await this.waitForDeliverable(request, candidate, job, async (observed) => {
        if (observed.state === 'BUDGET_PROPOSED' && observed.budget)
          proposedBudget = observed.budget;
        if (observed.state === 'FUNDED') fundingState = 'FUNDED';
        if (observedStates.at(-1) !== observed.state) observedStates.push(observed.state);
        await this.jobs.update({
          id: continuityJobId,
          state: observed.state,
          lifecycle: {
            initialState: 'CREATED',
            observedStates,
            fundingState,
            ...(proposedBudget ? { proposedBudget } : {}),
            ...(observed.deliverable === undefined
              ? {}
              : { deliverable: jsonValue(observed.deliverable) }),
          },
        });
      });
      job = await this.jobs.update({
        id: job.id,
        state: 'SUBMITTED',
        ...(snapshot.deliverable === undefined ? {} : { result: asObject(snapshot.deliverable) }),
      });
      const report = await this.verification.verify({
        mission: request.mission,
        agent: candidate.agent,
        capability: request.capabilities.join(','),
        result: {
          output: snapshot.deliverable ?? '',
          providerReference: snapshot.jobId,
          ...(snapshot.budget ? { cost: snapshot.budget } : {}),
        },
      });
      const terminal = report.passed ? 'COMPLETED' : 'REJECTED';
      await this.settle(request, candidate, snapshot, report);
      job = await this.jobs.update({
        id: job.id,
        state: terminal,
        ...(snapshot.deliverable === undefined ? {} : { result: asObject(snapshot.deliverable) }),
        verification: asObject(report),
        lifecycle: {
          initialState: 'CREATED',
          observedStates: [
            ...observedStates,
            ...(observedStates.at(-1) === terminal ? [] : [terminal]),
          ],
          fundingState,
          settlementState: terminal,
          ...(proposedBudget ? { proposedBudget } : {}),
          ...(snapshot.deliverable === undefined
            ? {}
            : { deliverable: jsonValue(snapshot.deliverable) }),
        },
      });
      if (observedStates.at(-1) !== terminal) observedStates.push(terminal);
      const cost =
        snapshot.budget ??
        (decision.selectedAgent.cost.amount && decision.selectedAgent.cost.currency
          ? {
              amount: decision.selectedAgent.cost.amount,
              currency: decision.selectedAgent.cost.currency,
            }
          : undefined);
      return {
        decision,
        job,
        verification: report,
        ...(cost ? { cost } : {}),
        lifecycle: {
          observedStates,
          initialState: 'CREATED',
          fundingState,
          settlementState: terminal,
          ...(proposedBudget ? { proposedBudget } : {}),
          ...(snapshot.deliverable === undefined
            ? {}
            : { deliverable: jsonValue(snapshot.deliverable) }),
        },
      };
    } catch (error) {
      const protocolError = error instanceof VirtualsProtocolError ? error : undefined;
      const recoveryErrorCode =
        error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : undefined;
      const reconciliationRequired = [
        'ACTION_OUTCOME_UNCERTAIN',
        'ACTION_RECONCILIATION_REQUIRED',
      ].includes(recoveryErrorCode ?? '');
      if (job) {
        await this.jobs.update({
          id: job.id,
          state: reconciliationRequired ? 'UNCERTAIN' : 'FAILED',
          errorCode: reconciliationRequired
            ? 'ACTION_RECONCILIATION_REQUIRED'
            : (protocolError?.code ?? 'VIRTUALS_PROVIDER_ERROR'),
          errorMessage:
            error instanceof Error ? error.message : 'Unknown Virtuals execution failure',
        });
      }
      await this.memory.recordFailure({
        missionId: request.mission.id,
        mission: request.mission.objective,
        capability: request.capabilities.join(','),
        agentId: candidate.agent.id,
        agentProvider: 'virtuals',
        result: 'Virtuals ACP execution did not produce a verified completed result.',
        failureReason:
          error instanceof Error ? error.message : 'Unknown Virtuals execution failure',
        recommendation: `Penalize ${candidate.agent.id} for comparable work until a newer successful verified outcome exists.`,
        ...(job ? { providerReference: job.externalJobId } : {}),
        tags: ['virtuals-acp', 'execution-failure'],
      });
      throw error;
    }
  }

  private async createOrRecoverJob(
    request: ExecuteVirtualsMissionRequest,
    candidate: VirtualsAgentCandidate,
  ): Promise<VirtualsJob> {
    const existing = await this.jobs.findByMissionAndAction(request.mission.id, request.actionId);
    if (existing) return existing;
    const action = await this.recovery.executeCriticalAction(
      { missionId: request.mission.id, actionId: request.actionId, kind: 'VIRTUALS_CREATE_JOB' },
      async () => {
        const externalJobId = await this.source.createJob({
          chainId: candidate.chainId,
          providerAddress: candidate.providerAddress,
          offeringName: candidate.offeringName,
          requirements: request.requirements,
        });
        return {
          receipt: { externalJobId, chainId: candidate.chainId },
          providerReference: externalJobId,
        };
      },
    );
    const externalJobId = action.receipt.externalJobId;
    if (typeof externalJobId !== 'string') {
      throw new VirtualsProtocolError(
        'VIRTUALS_PROVIDER_ERROR',
        'Recovered ACP job receipt has no external job id',
        false,
      );
    }
    return this.jobs.createOrGet({
      missionId: request.mission.id,
      actionId: request.actionId,
      externalJobId,
      chainId: candidate.chainId,
      agentId: candidate.agent.id,
      providerAddress: candidate.providerAddress,
      offeringName: candidate.offeringName,
      requirement: request.requirements,
    });
  }

  private async waitForDeliverable(
    request: ExecuteVirtualsMissionRequest,
    candidate: VirtualsAgentCandidate,
    job: VirtualsJob,
    observed: (snapshot: VirtualsJobSnapshot) => Promise<void>,
  ): Promise<VirtualsJobSnapshot> {
    const started = this.now();
    const timeoutMs = Math.min(this.timeoutMs, request.timeoutMs ?? this.timeoutMs);
    while (this.now() - started <= timeoutMs) {
      const snapshot = await this.source.getJob(job.chainId, job.externalJobId);
      await observed(snapshot);
      await this.jobs.update({ id: job.id, state: snapshot.state });
      this.logger.info(
        {
          event: 'virtuals.job.state',
          missionId: request.mission.id,
          jobId: snapshot.jobId,
          state: snapshot.state,
        },
        'Virtuals ACP job state observed',
      );
      if (snapshot.state === 'SUBMITTED' || snapshot.state === 'COMPLETED') return snapshot;
      if (snapshot.state === 'REJECTED')
        throw new VirtualsProtocolError(
          'VIRTUALS_JOB_REJECTED',
          'Virtuals ACP provider rejected the job',
          false,
        );
      if (snapshot.state === 'EXPIRED')
        throw new VirtualsProtocolError('VIRTUALS_JOB_EXPIRED', 'Virtuals ACP job expired', false);
      if (snapshot.state === 'BUDGET_PROPOSED') {
        await this.fund(request, candidate, snapshot);
        await this.jobs.update({ id: job.id, state: 'FUNDED' });
        await observed({ ...snapshot, state: 'FUNDED' });
      }
      await this.sleep(this.pollIntervalMs);
    }
    throw new VirtualsProtocolError(
      'VIRTUALS_JOB_TIMEOUT',
      'Timed out waiting for a Virtuals ACP deliverable',
      true,
    );
  }

  private async fund(
    request: ExecuteVirtualsMissionRequest,
    candidate: VirtualsAgentCandidate,
    snapshot: VirtualsJobSnapshot,
  ): Promise<void> {
    if (!snapshot.budget || snapshot.budget.currency.toUpperCase() !== 'USDC') {
      throw new VirtualsProtocolError(
        'VIRTUALS_BUDGET_EXCEEDED',
        'ACP funding requires an explicit USDC budget',
        false,
      );
    }
    const amount = positiveAmount(snapshot.budget.amount);
    const missionBudget = positiveAmount(request.mission.budget);
    if (
      amount === null ||
      missionBudget === null ||
      amount > missionBudget ||
      amount > this.options.maxJobUsdc
    ) {
      throw new VirtualsProtocolError(
        'VIRTUALS_BUDGET_EXCEEDED',
        `ACP proposed budget ${snapshot.budget.amount} USDC exceeds the allowed mission or provider limit`,
        false,
      );
    }
    await this.recovery.executeCriticalAction(
      {
        missionId: request.mission.id,
        actionId: `${request.actionId}:fund`,
        paymentId: `virtuals:${snapshot.chainId}:${snapshot.jobId}:fund`,
        kind: 'VIRTUALS_FUND_JOB',
      },
      async () => {
        await this.source.fundJob(snapshot.chainId, snapshot.jobId);
        return {
          receipt: { jobId: snapshot.jobId, amount: snapshot.budget!.amount, currency: 'USDC' },
          providerReference: snapshot.jobId,
        };
      },
    );
    this.logger.info(
      { event: 'virtuals.job.funded', jobId: snapshot.jobId, agentId: candidate.agent.id, amount },
      'Virtuals ACP job funded',
    );
  }

  private async settle(
    request: ExecuteVirtualsMissionRequest,
    candidate: VirtualsAgentCandidate,
    snapshot: VirtualsJobSnapshot,
    report: VerificationReport,
  ): Promise<void> {
    await this.recovery.executeCriticalAction(
      {
        missionId: request.mission.id,
        actionId: `${request.actionId}:settle`,
        kind: report.passed ? 'VIRTUALS_COMPLETE_JOB' : 'VIRTUALS_REJECT_JOB',
      },
      async () => {
        const reason = `Continuity verification ${report.id}: ${report.reasons.join(' ')}`;
        if (report.passed) await this.source.completeJob(snapshot.chainId, snapshot.jobId, reason);
        else await this.source.rejectJob(snapshot.chainId, snapshot.jobId, reason);
        return {
          receipt: {
            jobId: snapshot.jobId,
            verificationId: report.id,
            passed: report.passed,
            agentId: candidate.agent.id,
          },
          providerReference: snapshot.jobId,
        };
      },
    );
  }
}
