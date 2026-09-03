import type { Logger } from 'pino';
import type { AgentDecision } from '../decisions/decision.js';
import type { BasePaymentService } from '../integrations/base/base-payment-service.js';
import { BaseIntegrationError } from '../integrations/base/base-errors.js';
import type { BaseTransaction } from '../integrations/base/base-transaction.js';
import type {
  VirtualsExecutionResult,
  VirtualsExecutionService,
} from '../integrations/virtuals/virtuals-execution-service.js';
import { VirtualsProtocolError } from '../integrations/virtuals/virtuals-errors.js';
import type { MemoryService } from '../memory/memory-service.js';
import type { Mission } from '../missions/mission.js';
import type { MissionService } from '../missions/mission-service.js';
import type { RecoveryService } from '../recovery/recovery-service.js';
import { AppError } from '../shared/errors/app-error.js';
import type { VerificationReport } from '../verification/verification.js';
import { parseMissionPlan, type MissionPlanCaps, type ParsedMissionPlan } from './mission-plan.js';

export interface MissionAttempt {
  readonly number: number;
  readonly actionId: string;
  readonly agentId?: string;
  readonly jobId?: string;
  readonly decision?: AgentDecision;
  readonly verification?: VerificationReport;
  readonly status: 'VERIFIED' | 'VERIFICATION_FAILED' | 'EXECUTION_FAILED';
  readonly failureReason?: string;
}

export interface MissionRunResult {
  readonly mission: Mission;
  readonly plan: ParsedMissionPlan;
  readonly attempts: readonly MissionAttempt[];
  readonly selectedAgentId: string;
  readonly jobId: string;
  readonly verification: VerificationReport;
  readonly baseTransaction?: BaseTransaction;
}

export interface MissionRunnerOptions extends MissionPlanCaps {
  readonly now?: () => number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown mission execution failure';
}

export class MissionRunner {
  private readonly now: () => number;

  constructor(
    private readonly missions: MissionService,
    private readonly virtuals: VirtualsExecutionService,
    private readonly basePayments: BasePaymentService | undefined,
    private readonly memory: MemoryService,
    private readonly recovery: RecoveryService,
    private readonly logger: Logger,
    private readonly options: MissionRunnerOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  async run(missionId: string): Promise<MissionRunResult> {
    let mission = await this.missions.get(missionId);
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(mission.status)) {
      throw new AppError({
        statusCode: 409,
        code: 'MISSION_ALREADY_TERMINAL',
        message: `Mission is already terminal in state ${mission.status}`,
      });
    }
    if (!['CREATED', 'QUEUED', 'RECOVERING'].includes(mission.status)) {
      throw new AppError({
        statusCode: 409,
        code: 'MISSION_RUN_STATE_CONFLICT',
        message: `Autonomous execution requires CREATED, QUEUED, or reconciled RECOVERING state; found ${mission.status}`,
      });
    }
    const startedAt = this.now();
    const plan = parseMissionPlan(mission, this.options);
    const attempts: MissionAttempt[] = [];
    const excludedAgentIds = new Set<string>();
    const agentFailures = new Map<string, number>();
    let failures = 0;

    mission = await this.missions.transition(
      mission.id,
      'PLANNING',
      'Autonomous runner parsed mission requirements and limits',
    );
    this.logStep(mission, 'requirements.parsed', { plan });
    let preflightMemory;
    try {
      preflightMemory = await this.memory.recall({
        mission: mission.objective,
        ...(mission.organizationId ? { organizationId: mission.organizationId } : {}),
        capabilities: plan.capabilities,
        categories: ['outcome', 'failure', 'experience'],
        limit: 50,
      });
    } catch (error) {
      return this.fail(
        mission,
        plan,
        attempts,
        `Required Sibyl recall failed: ${errorMessage(error)}`,
      );
    }
    this.logStep(mission, 'memory.recalled', {
      memoryReferences: preflightMemory.records.map(({ sibylRecordId }) => sibylRecordId),
    });
    mission = await this.missions.transition(
      mission.id,
      'SELECTING_AGENT',
      'Recall Sibyl experience and discover candidates',
    );

    for (
      let attemptNumber = 1;
      attemptNumber <= plan.limits.maximumRetries + 1;
      attemptNumber += 1
    ) {
      if (this.now() - startedAt >= plan.limits.timeoutMs) {
        return this.fail(
          mission,
          plan,
          attempts,
          'Autonomous mission exceeded its configured timeout',
        );
      }
      if (failures >= plan.limits.failureThreshold) break;
      if (mission.status === 'RECOVERING') {
        mission = await this.missions.transition(
          mission.id,
          'SELECTING_AGENT',
          'Retry with a fallback agent after recorded failure',
        );
      }
      mission = await this.missions.transition(
        mission.id,
        'EXECUTING',
        `Execute bounded agent attempt ${attemptNumber}`,
      );
      const actionId = `mission:${mission.id}:agent-attempt:${attemptNumber}`;
      let execution: VirtualsExecutionResult;
      try {
        execution = await this.virtuals.execute({
          mission,
          actionId,
          capabilities: plan.capabilities,
          requirements: plan.requirements,
          candidateLimit: plan.limits.candidateLimit,
          excludedAgentIds: [...excludedAgentIds],
          budgetCurrency: plan.budgetCurrency,
          timeoutMs: Math.max(1, plan.limits.timeoutMs - (this.now() - startedAt)),
        });
      } catch (error) {
        if (
          error instanceof VirtualsProtocolError &&
          error.code === 'VIRTUALS_FUNDING_APPROVAL_REQUIRED'
        ) {
          mission = await this.missions.transition(
            mission.id,
            'AWAITING_FUNDING_APPROVAL',
            'ACP budget proposal requires explicit operator approval',
          );
          await this.checkpoint(mission, plan, undefined, actionId, failures, 'approve-acp-spend');
          throw new AppError({
            statusCode: 409,
            code: 'MISSION_AWAITING_FUNDING_APPROVAL',
            message: 'Mission paused safely pending explicit ACP spend approval',
          });
        }
        failures += 1;
        attempts.push({
          number: attemptNumber,
          actionId,
          status: 'EXECUTION_FAILED',
          failureReason: errorMessage(error),
        });
        this.logger.warn(
          {
            event: 'mission.runner.failure',
            missionId,
            attemptNumber,
            failures,
            failureReason: errorMessage(error),
          },
          'Autonomous agent execution failed',
        );
        if (this.canRetry(attemptNumber, failures, plan, startedAt)) {
          mission = await this.missions.transition(
            mission.id,
            'RECOVERING',
            'Execution failure recorded in Sibyl; choose fallback or retry',
          );
          await this.checkpoint(
            mission,
            plan,
            undefined,
            actionId,
            failures,
            'select-fallback-agent',
          );
          continue;
        }
        return this.fail(mission, plan, attempts, errorMessage(error));
      }

      mission = await this.missions.transition(
        mission.id,
        'VERIFYING',
        'Verify the returned external agent result',
      );
      const attempt: MissionAttempt = {
        number: attemptNumber,
        actionId,
        agentId: execution.decision.selectedAgent.id,
        jobId: execution.job.externalJobId,
        decision: execution.decision,
        verification: execution.verification,
        status: execution.verification.passed ? 'VERIFIED' : 'VERIFICATION_FAILED',
        ...(execution.verification.passed
          ? {}
          : { failureReason: execution.verification.reasons.join(' ') }),
      };
      attempts.push(attempt);
      if (!execution.verification.passed) {
        failures += 1;
        const agentId = execution.decision.selectedAgent.id;
        const agentFailureCount = (agentFailures.get(agentId) ?? 0) + 1;
        agentFailures.set(agentId, agentFailureCount);
        // Let the Sibyl-backed decision react to fresh negative experience.
        // A repeated failure still forces exclusion as a bounded safety measure.
        if (agentFailureCount >= 2) excludedAgentIds.add(agentId);
        this.logger.warn(
          {
            event: 'mission.runner.verification_failed',
            missionId,
            attemptNumber,
            agentId: execution.decision.selectedAgent.id,
            failures,
            failedRequirements: execution.verification.failedRequirements,
          },
          'Verification failure will influence the next Sibyl-backed selection',
        );
        if (this.canRetry(attemptNumber, failures, plan, startedAt)) {
          mission = await this.missions.transition(
            mission.id,
            'RECOVERING',
            'Verification failure recorded; select a fallback agent',
          );
          await this.checkpoint(
            mission,
            plan,
            execution.decision.selectedAgent.id,
            actionId,
            failures,
            'select-fallback-agent',
          );
          continue;
        }
        return this.fail(mission, plan, attempts, execution.verification.reasons.join(' '));
      }

      let baseTransaction: BaseTransaction | undefined;
      try {
        baseTransaction = plan.requireBaseAction
          ? await this.executeBaseWithRetries(mission, plan, execution, startedAt)
          : undefined;
      } catch (error) {
        if (error instanceof BaseIntegrationError && error.code === 'BASE_APPROVAL_REQUIRED') {
          mission = await this.missions.transition(
            mission.id,
            'AWAITING_BASE_APPROVAL',
            'Verified mission requires separate Base mainnet settlement approval',
          );
          await this.checkpoint(
            mission,
            plan,
            execution.decision.selectedAgent.id,
            `mission:${mission.id}:base-success-settlement`,
            failures,
            'approve-base-settlement',
            execution.verification,
          );
          throw new AppError({
            statusCode: 409,
            code: 'MISSION_AWAITING_BASE_APPROVAL',
            message: 'Mission paused safely pending explicit Base mainnet approval',
          });
        }
        return this.fail(mission, plan, attempts, errorMessage(error));
      }
      try {
        await this.memory.recordOutcome({
          missionId: mission.id,
          ...(mission.organizationId ? { organizationId: mission.organizationId } : {}),
          mission: mission.objective,
          agentId: execution.decision.selectedAgent.id,
          agentProvider: execution.decision.selectedAgent.provider,
          capability: plan.capabilities.join(','),
          result: `Mission completed with verified Virtuals job ${execution.job.externalJobId}${baseTransaction ? ` and confirmed Base transaction ${baseTransaction.transactionHash}` : ''}.`,
          success: true,
          verification: {
            status: 'PASS',
            summary: execution.verification.reasons.join(' '),
            verifierVersion: execution.verification.verifierVersion,
            score: execution.verification.score,
          },
          ...(execution.decision.selectedAgent.cost.amount &&
          execution.decision.selectedAgent.cost.currency
            ? {
                cost: {
                  amount: execution.decision.selectedAgent.cost.amount,
                  currency: execution.decision.selectedAgent.cost.currency,
                },
              }
            : {}),
          providerReference: baseTransaction?.transactionHash ?? execution.job.externalJobId,
          recommendation: `Reuse ${execution.decision.selectedAgent.id} for comparable work when the cited verified evidence remains relevant.`,
          memoryReferences: execution.decision.memoryReferences,
          tags: ['autonomous-mission', 'verified-outcome'],
        });
      } catch (error) {
        return this.fail(
          mission,
          plan,
          attempts,
          `Required Sibyl outcome write failed: ${errorMessage(error)}`,
        );
      }
      mission = await this.missions.transition(
        mission.id,
        'COMPLETED',
        'Verified result, required Base action, and Sibyl updates completed',
      );
      await this.checkpoint(
        mission,
        plan,
        execution.decision.selectedAgent.id,
        actionId,
        failures,
        'none',
        execution.verification,
        baseTransaction,
      );
      this.logger.info(
        {
          event: 'mission.runner.completed',
          missionId,
          attempts: attempts.length,
          selectedAgentId: execution.decision.selectedAgent.id,
          virtualsJobId: execution.job.externalJobId,
          baseTransactionHash: baseTransaction?.transactionHash,
        },
        'Autonomous mission completed',
      );
      return {
        mission,
        plan,
        attempts,
        selectedAgentId: execution.decision.selectedAgent.id,
        jobId: execution.job.externalJobId,
        verification: execution.verification,
        ...(baseTransaction ? { baseTransaction } : {}),
      };
    }
    return this.fail(
      mission,
      plan,
      attempts,
      'Mission limits exhausted before verified completion',
    );
  }

  private async executeBaseWithRetries(
    mission: Mission,
    plan: ParsedMissionPlan,
    execution: VirtualsExecutionResult,
    startedAt: number,
  ): Promise<BaseTransaction> {
    if (!this.basePayments)
      throw new AppError({
        statusCode: 503,
        code: 'BASE_INTEGRATION_UNAVAILABLE',
        message: 'Mission requires a Base action but Base is not enabled',
      });
    const selected = execution.decision.selectedAgent;
    const action = plan.baseAction;
    if (!action || (action.asset && action.asset !== this.basePayments.supportedAsset)) {
      throw new AppError({
        statusCode: 422,
        code: 'RUNNER_BASE_ASSET_MISMATCH',
        message: 'Mission settlement asset does not match the configured Base asset',
      });
    }
    const externalCost = Number(execution.cost?.amount ?? selected.cost.amount);
    const baseCost = Number(action.amount);
    const missionBudget = Number(mission.budget);
    const sameCurrency =
      (execution.cost?.currency ?? selected.cost.currency)?.toUpperCase() ===
      this.basePayments.supportedAsset;
    if (
      !Number.isFinite(externalCost) ||
      !Number.isFinite(baseCost) ||
      !Number.isFinite(missionBudget) ||
      baseCost > missionBudget ||
      (sameCurrency && externalCost + baseCost > missionBudget)
    ) {
      throw new AppError({
        statusCode: 422,
        code: 'MISSION_TOTAL_BUDGET_EXCEEDED',
        message: 'Combined Virtuals execution and required Base action exceed the mission budget',
      });
    }
    const actionId = `mission:${mission.id}:base-success-settlement`;
    const paymentId = `mission-success-settlement:${mission.id}`;
    let lastError: unknown;
    for (let retry = 0; retry <= plan.limits.maximumRetries; retry += 1) {
      this.assertWithinTimeout(startedAt, plan);
      try {
        return await this.basePayments.pay({
          mission,
          actionId,
          paymentId,
          agentId: selected.id,
          amount: action.amount,
          verificationId: execution.verification.id,
        });
      } catch (error) {
        lastError = error;
        this.logger.warn(
          {
            event: 'mission.runner.base_failure',
            missionId: mission.id,
            paymentId,
            retry,
            failureReason: errorMessage(error),
          },
          'Required Base action failed',
        );
        if (
          error instanceof AppError &&
          ['ACTION_OUTCOME_UNCERTAIN', 'ACTION_RECONCILIATION_REQUIRED'].includes(error.code)
        )
          break;
      }
    }
    throw lastError;
  }

  private canRetry(
    attempt: number,
    failures: number,
    plan: ParsedMissionPlan,
    startedAt: number,
  ): boolean {
    return (
      attempt <= plan.limits.maximumRetries &&
      failures < plan.limits.failureThreshold &&
      this.now() - startedAt < plan.limits.timeoutMs
    );
  }

  private assertWithinTimeout(startedAt: number, plan: ParsedMissionPlan): void {
    if (this.now() - startedAt >= plan.limits.timeoutMs)
      throw new AppError({
        statusCode: 408,
        code: 'MISSION_RUN_TIMEOUT',
        message: 'Autonomous mission exceeded its configured timeout',
      });
  }

  private async fail(
    mission: Mission,
    plan: ParsedMissionPlan,
    attempts: readonly MissionAttempt[],
    reason: string,
  ): Promise<never> {
    const failed = await this.missions.transition(mission.id, 'FAILED', reason.slice(0, 500));
    try {
      await this.memory.recordFailure({
        missionId: failed.id,
        ...(failed.organizationId ? { organizationId: failed.organizationId } : {}),
        mission: failed.objective,
        capability: plan.capabilities.join(','),
        result: 'Autonomous mission terminated without a verified completion.',
        failureReason: reason,
        recommendation:
          'Review the cited attempts and adjust agent availability, budget, or mission limits before a new mission.',
        tags: ['autonomous-mission', 'terminal-failure'],
      });
    } catch (memoryError) {
      this.logger.error(
        {
          event: 'mission.runner.memory_write_failed',
          missionId: failed.id,
          failureReason: errorMessage(memoryError),
        },
        'Terminal mission failure could not be written to required Sibyl memory',
      );
    }
    this.logger.error(
      {
        event: 'mission.runner.failed',
        missionId: failed.id,
        attempts: attempts.length,
        failureReason: reason,
      },
      'Autonomous mission failed within explicit limits',
    );
    throw new AppError({
      statusCode: 422,
      code: 'MISSION_RUN_FAILED',
      message: reason,
      details: { missionId: failed.id, attempts },
    });
  }

  private checkpoint(
    mission: Mission,
    plan: ParsedMissionPlan,
    selectedAgentId: string | undefined,
    actionId: string,
    failures: number,
    nextAction: string,
    verification?: VerificationReport,
    base?: BaseTransaction,
  ) {
    const awaitingApproval = ['AWAITING_FUNDING_APPROVAL', 'AWAITING_BASE_APPROVAL'].includes(
      mission.status,
    );
    return this.recovery.checkpoint({
      missionId: mission.id,
      mission: mission.objective,
      capability: plan.capabilities.join(','),
      missionState: mission.status,
      currentStep: mission.currentStep,
      ...(selectedAgentId ? { selectedAgentId } : {}),
      actionState: {
        actionId,
        status:
          mission.status === 'COMPLETED'
            ? 'COMPLETED'
            : awaitingApproval
              ? 'NOT_STARTED'
              : 'FAILED',
      },
      paymentState: base
        ? {
            paymentId: base.paymentId,
            status: base.status === 'CONFIRMED' ? 'COMPLETED' : 'FAILED',
          }
        : { status: plan.requireBaseAction ? 'NOT_STARTED' : 'NOT_APPLICABLE' },
      verificationState: verification
        ? { status: verification.passed ? 'PASS' : 'FAIL', reportId: verification.id }
        : { status: 'NOT_STARTED' },
      recoveryInfo: {
        interrupted: false,
        ...(failures > 0 ? { reason: `${failures} bounded failures observed` } : {}),
      },
      nextAction,
    });
  }

  private logStep(mission: Mission, event: string, details: object): void {
    this.logger.info(
      {
        event: `mission.runner.${event}`,
        missionId: mission.id,
        status: mission.status,
        ...details,
      },
      'Autonomous mission runner step',
    );
  }
}
