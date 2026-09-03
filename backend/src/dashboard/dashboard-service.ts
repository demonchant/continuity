import { inferMissionCapabilities } from '../agents/mission-agent-candidates.js';
import type { OperatorApprovalService } from '../approvals/operator-approval-service.js';
import type { BaseTransactionRepository } from '../integrations/base/base-transaction-repository.js';
import type { BaseTransaction } from '../integrations/base/base-transaction.js';
import type { VirtualsJobRepository } from '../integrations/virtuals/virtuals-job-repository.js';
import type { VirtualsJob } from '../integrations/virtuals/virtuals-job.js';
import type { MemoryRecord, RecalledMemory } from '../memory/memory-record.js';
import type { MemoryService } from '../memory/memory-service.js';
import type { Mission } from '../missions/mission.js';
import type { MissionService } from '../missions/mission-service.js';
import { AppError } from '../shared/errors/app-error.js';

interface AgentExperienceSummary {
  readonly agentId: string;
  readonly provider?: string;
  readonly capabilities: readonly string[];
  readonly observations: number;
  readonly successes: number;
  readonly failures: number;
  readonly verificationRate: number | null;
  readonly averageCost: { readonly amount: string; readonly currency: string } | null;
  readonly lastObservedAt: string;
  readonly failurePatterns: readonly { readonly reason: string; readonly count: number }[];
}

function safeMission(mission: Mission) {
  return {
    id: mission.id,
    objective: mission.objective,
    budget: mission.budget,
    constraints: mission.constraints,
    status: mission.status,
    currentStep: mission.currentStep,
    ...(mission.recoveryState ? { recoveryState: mission.recoveryState } : {}),
    ...(mission.lastHeartbeat ? { lastHeartbeat: mission.lastHeartbeat } : {}),
    ...(mission.lastReconciliation ? { lastReconciliation: mission.lastReconciliation } : {}),
    ...(mission.recoveryFailureReason
      ? { recoveryFailureReason: mission.recoveryFailureReason }
      : {}),
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
  };
}

function safeMemory(memory: RecalledMemory) {
  const record = memory.record;
  return {
    sibylRecordId: memory.sibylRecordId,
    sibylTier: memory.sibylTier,
    ...(memory.relevance !== undefined ? { relevance: memory.relevance } : {}),
    id: record.id,
    category: record.category,
    timestamp: record.timestamp,
    missionId: record.missionId,
    mission: record.mission,
    capability: record.capability,
    ...(record.agentId ? { agentId: record.agentId } : {}),
    ...(record.agentProvider ? { agentProvider: record.agentProvider } : {}),
    ...(record.result ? { result: record.result } : {}),
    ...(record.verification ? { verification: record.verification } : {}),
    ...(record.cost ? { cost: record.cost } : {}),
    ...(record.latencyMs !== undefined ? { latencyMs: record.latencyMs } : {}),
    ...(record.success !== undefined ? { success: record.success } : {}),
    ...(record.failureReason ? { failureReason: record.failureReason } : {}),
    ...(record.decisionReason ? { decisionReason: record.decisionReason } : {}),
    ...(record.confidence !== undefined ? { confidence: record.confidence } : {}),
    ...(record.recommendation ? { recommendation: record.recommendation } : {}),
    ...(record.providerReference ? { providerReference: record.providerReference } : {}),
    ...(record.evidenceHash ? { evidenceHash: record.evidenceHash } : {}),
    ...(record.provenance ? { provenance: record.provenance } : {}),
    ...(record.tags ? { tags: record.tags } : {}),
    ...(record.memoryReferences ? { memoryReferences: record.memoryReferences } : {}),
    ...(record.decisionCandidates ? { decisionCandidates: record.decisionCandidates } : {}),
  };
}

function mergeRecallRecords(
  ...groups: readonly (readonly RecalledMemory[])[]
): readonly RecalledMemory[] {
  const records = new Map<string, RecalledMemory>();
  for (const group of groups) {
    for (const memory of group) records.set(memory.record.id, memory);
  }
  return [...records.values()].sort((left, right) =>
    right.record.timestamp.localeCompare(left.record.timestamp),
  );
}

function safeJob(job: VirtualsJob) {
  return {
    id: job.id,
    actionId: job.actionId,
    externalJobId: job.externalJobId,
    chainId: job.chainId,
    agentId: job.agentId,
    providerAddress: job.providerAddress,
    offeringName: job.offeringName,
    state: job.state,
    requirement: job.requirement,
    ...(job.result ? { result: job.result } : {}),
    ...(job.verification ? { verification: job.verification } : {}),
    ...(job.lifecycle ? { lifecycle: job.lifecycle } : {}),
    ...(job.evidenceHash ? { evidenceHash: job.evidenceHash } : {}),
    ...(job.provenance ? { provenance: job.provenance } : {}),
    ...(job.errorCode ? { errorCode: job.errorCode } : {}),
    ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.completedAt ? { completedAt: job.completedAt } : {}),
  };
}

function safeTransaction(transaction: BaseTransaction) {
  return {
    id: transaction.id,
    actionId: transaction.actionId,
    paymentId: transaction.paymentId,
    agentId: transaction.agentId,
    ...(transaction.transactionHash ? { transactionHash: transaction.transactionHash } : {}),
    network: transaction.network,
    chainId: transaction.chainId,
    action: transaction.action,
    purpose:
      transaction.action === 'MISSION_SUCCESS_SETTLEMENT'
        ? 'Separate post-verification mission settlement; not Virtuals ACP provider funding.'
        : 'Legacy agent payment.',
    ...(transaction.verificationId ? { verificationId: transaction.verificationId } : {}),
    recipient: transaction.recipient,
    amount: transaction.amount,
    asset: transaction.asset,
    status: transaction.status,
    ...(transaction.blockNumber !== undefined
      ? { blockNumber: transaction.blockNumber.toString() }
      : {}),
    ...(transaction.confirmations !== undefined
      ? { confirmations: transaction.confirmations }
      : {}),
    ...(transaction.explorerUrl ? { explorerUrl: transaction.explorerUrl } : {}),
    ...(transaction.memoryRecordId ? { memoryRecordId: transaction.memoryRecordId } : {}),
    ...(transaction.sibylRecordId ? { sibylRecordId: transaction.sibylRecordId } : {}),
    ...(transaction.sibylEventId ? { sibylEventId: transaction.sibylEventId } : {}),
    ...(transaction.errorCode ? { errorCode: transaction.errorCode } : {}),
    ...(transaction.errorMessage ? { errorMessage: transaction.errorMessage } : {}),
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
    ...(transaction.confirmedAt ? { confirmedAt: transaction.confirmedAt } : {}),
  };
}

function agentExperience(records: readonly MemoryRecord[]): readonly AgentExperienceSummary[] {
  const grouped = new Map<string, MemoryRecord[]>();
  for (const record of records) {
    if (!record.agentId || !['experience', 'failure', 'outcome'].includes(record.category))
      continue;
    const existing = grouped.get(record.agentId) ?? [];
    existing.push(record);
    grouped.set(record.agentId, existing);
  }
  return [...grouped.entries()]
    .map(([agentId, observations]): AgentExperienceSummary => {
      const verified = observations.filter(({ verification }) =>
        verification ? verification.status !== 'NOT_RUN' : false,
      );
      const costs = observations.flatMap(({ cost }) => {
        if (!cost) return [];
        const amount = Number(cost.amount);
        return Number.isFinite(amount) ? [{ amount, currency: cost.currency }] : [];
      });
      const currencies = new Set(costs.map(({ currency }) => currency));
      const patterns = new Map<string, number>();
      for (const observation of observations) {
        if (observation.category !== 'failure' && observation.success !== false) continue;
        const reason = observation.failureReason ?? 'Unspecified failure';
        patterns.set(reason, (patterns.get(reason) ?? 0) + 1);
      }
      const successes = observations.filter(
        ({ success, verification }) => success === true || verification?.status === 'PASS',
      ).length;
      return {
        agentId,
        ...(observations.find(({ agentProvider }) => agentProvider)?.agentProvider
          ? { provider: observations.find(({ agentProvider }) => agentProvider)!.agentProvider }
          : {}),
        capabilities: [
          ...new Set(
            observations.flatMap(({ capability }) =>
              capability
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
            ),
          ),
        ],
        observations: observations.length,
        successes,
        failures: observations.length - successes,
        verificationRate:
          verified.length === 0
            ? null
            : verified.filter(({ verification }) => verification?.status === 'PASS').length /
              verified.length,
        averageCost:
          costs.length > 0 && currencies.size === 1
            ? {
                amount: (costs.reduce((sum, cost) => sum + cost.amount, 0) / costs.length).toFixed(
                  2,
                ),
                currency: costs[0]!.currency,
              }
            : null,
        lastObservedAt: observations
          .map(({ timestamp }) => timestamp)
          .sort((left, right) => right.localeCompare(left))[0]!,
        failurePatterns: [...patterns.entries()]
          .map(([reason, count]) => ({ reason, count }))
          .sort((left, right) => right.count - left.count),
      };
    })
    .sort(
      (left, right) =>
        right.observations - left.observations || left.agentId.localeCompare(right.agentId),
    );
}

function whyThisAgent(
  mission: Mission,
  decision: MemoryRecord | undefined,
  agents: readonly AgentExperienceSummary[],
): readonly string[] {
  if (!decision?.agentId) return [];
  const selected = agents.find(({ agentId }) => agentId === decision.agentId);
  const alternatives = agents.filter(({ agentId }) => agentId !== decision.agentId);
  const bullets: string[] = [];
  if (selected?.successes) {
    bullets.push(
      `${selected.successes} relevant historical outcome${selected.successes === 1 ? '' : 's'} succeeded`,
    );
  }
  if (selected?.verificationRate !== null && selected?.verificationRate !== undefined) {
    bullets.push(`${Math.round(selected.verificationRate * 100)}% historical verification rate`);
  }
  const failedAlternative = alternatives.sort((a, b) => b.failures - a.failures)[0];
  if (failedAlternative?.failures) {
    bullets.push(
      `${failedAlternative.agentId} recorded ${failedAlternative.failures} relevant failure${failedAlternative.failures === 1 ? '' : 's'}`,
    );
  }
  if (decision.cost && Number(decision.cost.amount) <= Number(mission.budget)) {
    bullets.push(`${decision.cost.amount} ${decision.cost.currency} cost is within mission budget`);
  }
  if (decision.memoryReferences?.length) {
    bullets.push(
      `${decision.memoryReferences.length} cited Sibyl record${decision.memoryReferences.length === 1 ? '' : 's'} influenced selection`,
    );
  }
  return bullets;
}

export class DashboardService {
  constructor(
    private readonly missions: MissionService,
    private readonly memory: MemoryService,
    private readonly jobs?: VirtualsJobRepository,
    private readonly transactions?: BaseTransactionRepository,
    private readonly approvals?: OperatorApprovalService,
    private readonly productConfig?: {
      readonly virtuals?: { readonly chainId: number; readonly maxJobUsdc: number };
      readonly base?: {
        readonly enabled: boolean;
        readonly network: string;
        readonly chainId: number;
        readonly asset: string;
        readonly recipient?: string;
        readonly maximumAmount: string;
      };
    },
  ) {}

  async overview() {
    const missions = await this.missions.list();
    return {
      generatedAt: new Date().toISOString(),
      product: this.productConfig ?? {},
      metrics: {
        total: missions.length,
        active: missions.filter(({ status }) =>
          [
            'PLANNING',
            'SELECTING_AGENT',
            'EXECUTING',
            'AWAITING_FUNDING_APPROVAL',
            'VERIFYING',
            'AWAITING_BASE_APPROVAL',
            'RECOVERING',
          ].includes(status),
        ).length,
        completed: missions.filter(({ status }) => status === 'COMPLETED').length,
        failed: missions.filter(({ status }) => status === 'FAILED').length,
      },
      missions: missions.map(safeMission),
    };
  }

  async judgeOverview() {
    const overview = await this.overview();
    return {
      generatedAt: overview.generatedAt,
      missions: overview.missions
        .filter(({ status }) => ['COMPLETED', 'FAILED'].includes(status))
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
        .slice(0, 20),
    };
  }

  async judgeMissionDetail(missionId: string) {
    const mission = await this.missions.get(missionId);
    if (!['COMPLETED', 'FAILED'].includes(mission.status)) {
      throw new AppError({
        statusCode: 404,
        code: 'JUDGE_RECEIPT_NOT_AVAILABLE',
        message: 'A public judge receipt is available only for terminal missions',
      });
    }
    const { approvals, ...publicReceipt } = await this.missionDetail(missionId);
    void approvals;
    return publicReceipt;
  }

  async missionDetail(missionId: string) {
    const mission = await this.missions.get(missionId);
    const explicitCapabilities = Array.isArray(mission.constraints.capabilities)
      ? mission.constraints.capabilities.filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0,
        )
      : [];
    const capabilities = [
      ...new Set([...inferMissionCapabilities(mission.objective), ...explicitCapabilities]),
    ];
    const categories = [
      'mission',
      'agent',
      'decision',
      'outcome',
      'failure',
      'experience',
      'recovery_checkpoint',
    ] as const;
    const [decisionRecall, missionRecall, jobs, transactions, approvals] = await Promise.all([
      this.memory.recall({
        mission: mission.objective,
        ...(mission.organizationId ? { organizationId: mission.organizationId } : {}),
        capabilities,
        categories,
        limit: 50,
      }),
      this.memory.recall({
        mission: mission.objective,
        ...(mission.organizationId ? { organizationId: mission.organizationId } : {}),
        capabilities: [],
        categories,
        limit: 50,
      }),
      this.jobs?.findByMissionId(missionId) ?? Promise.resolve([]),
      this.transactions?.findByMissionId(missionId) ?? Promise.resolve([]),
      this.approvals?.list(missionId) ?? Promise.resolve([]),
    ]);
    const recalled = mergeRecallRecords(decisionRecall.records, missionRecall.records);
    const records = recalled.map(({ record }) => record);
    const agents = agentExperience(records);
    const decision = records
      .filter(
        ({ category, missionId: recordMissionId }) =>
          category === 'decision' && recordMissionId === mission.id,
      )
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0];
    const decisionReferences = new Set(decision?.memoryReferences ?? []);
    const affected = decisionRecall.records.filter(({ sibylRecordId }) =>
      decisionReferences.has(sibylRecordId),
    );
    const missionRecords = recalled.filter(({ record }) => record.missionId === mission.id);
    const writtenAfterward = decision
      ? missionRecords.filter(
          ({ record }) => record.category !== 'decision' && record.timestamp > decision.timestamp,
        )
      : [];
    const outcome = missionRecords
      .filter(({ record }) => ['outcome', 'experience', 'failure'].includes(record.category))
      .sort((left, right) => right.record.timestamp.localeCompare(left.record.timestamp))[0];
    const impact = !decision
      ? {
          level: 'AWAITING_DECISION' as const,
          citedCount: 0,
          resolvedCount: 0,
          summary: 'No stored decision exists for this mission yet.',
        }
      : decisionReferences.size === 0
        ? {
            level: 'NO_HISTORICAL_PREFERENCE' as const,
            citedCount: 0,
            resolvedCount: 0,
            summary: `The stored decision selecting ${decision.agentId ?? 'an agent'} cites no historical Sibyl records.`,
          }
        : affected.length === 0
          ? {
              level: 'CITATIONS_UNRESOLVED' as const,
              citedCount: decisionReferences.size,
              resolvedCount: 0,
              summary: `The stored decision cites ${decisionReferences.size} Sibyl record${decisionReferences.size === 1 ? '' : 's'}, but the current recall did not return them.`,
            }
          : {
              level: 'LOAD_BEARING' as const,
              citedCount: decisionReferences.size,
              resolvedCount: affected.length,
              summary: `${affected.length} currently retrieved Sibyl record${affected.length === 1 ? '' : 's'} are cited by the stored decision selecting ${decision.agentId ?? 'an agent'}.`,
            };
    return {
      generatedAt: new Date().toISOString(),
      mission: safeMission(mission),
      capabilities,
      memory: {
        provider: decisionRecall.provider,
        query: decisionRecall.query,
        records: recalled.map(safeMemory),
        trace: {
          remembered: recalled.map(safeMemory),
          retrieved: decisionRecall.records.map(safeMemory),
          affectedDecision: affected.map(safeMemory),
          missionWrites: missionRecords.map(safeMemory),
          writtenAfterward: writtenAfterward.map(safeMemory),
          outcome: outcome ? safeMemory(outcome) : null,
          impact,
        },
      },
      agents,
      decision: decision
        ? {
            selectedAgentId: decision.agentId,
            reason: decision.decisionReason,
            confidence: decision.confidence,
            cost: decision.cost,
            memoryReferences: decision.memoryReferences ?? [],
            candidates: decision.decisionCandidates ?? [],
            why: whyThisAgent(mission, decision, agents),
          }
        : null,
      jobs: jobs.map(safeJob),
      transactions: transactions.map(safeTransaction),
      approvals,
      product: this.productConfig ?? {},
    };
  }
}
