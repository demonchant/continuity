import type { BaseTransactionGateway } from '../integrations/base/base-gateway.js';
import type { BaseTransactionRepository } from '../integrations/base/base-transaction-repository.js';
import type { VirtualsAgentSource } from '../integrations/virtuals/virtuals-agent-source.js';
import type { VirtualsJobRepository } from '../integrations/virtuals/virtuals-job-repository.js';
import type { JsonObject, Mission } from '../missions/mission.js';
import type { MissionReconciliationResult } from '../runner/mission-worker.js';
import type { RecoveryService } from './recovery-service.js';
import type { RecoveryAction } from './recovery.js';

const ambiguousStatuses = new Set(['IN_PROGRESS', 'UNCERTAIN']);

export class MissionReconciliationCoordinator {
  constructor(
    private readonly recovery: RecoveryService,
    private readonly virtuals: VirtualsAgentSource,
    private readonly virtualsJobs: VirtualsJobRepository,
    private readonly baseTransactions: BaseTransactionRepository,
    private readonly baseGateway?: BaseTransactionGateway,
  ) {}

  async reconcile(mission: Mission): Promise<MissionReconciliationResult> {
    const jobs = await this.virtualsJobs.findByMissionId(mission.id);
    const observedJobs: JsonObject[] = [];
    for (const job of jobs) {
      const snapshot = await this.virtuals.getJob(job.chainId, job.externalJobId);
      await this.virtualsJobs.update({
        id: job.id,
        state: snapshot.state,
        ...(snapshot.deliverable === undefined
          ? {}
          : {
              result:
                typeof snapshot.deliverable === 'string'
                  ? { value: snapshot.deliverable }
                  : snapshot.deliverable,
            }),
      });
      observedJobs.push({
        continuityJobId: job.id,
        externalJobId: job.externalJobId,
        state: snapshot.state,
      });
    }

    const transactions = await this.baseTransactions.findByMissionId(mission.id);
    const observedTransactions: JsonObject[] = [];
    for (const transaction of transactions) {
      let status = transaction.status;
      if (
        this.baseGateway &&
        transaction.transactionHash &&
        ['SUBMITTED', 'UNCERTAIN'].includes(transaction.status)
      ) {
        const receipt = await this.baseGateway.getConfirmation(transaction.transactionHash);
        if (receipt) {
          status = receipt.status === 'success' ? 'CONFIRMED' : 'FAILED';
          await this.baseTransactions.update({
            id: transaction.id,
            status,
            transactionHash: transaction.transactionHash,
            blockNumber: receipt.blockNumber,
            ...(status === 'FAILED'
              ? {
                  errorCode: 'BASE_TRANSACTION_REVERTED',
                  errorMessage: 'Base reconciliation observed a reverted transaction',
                }
              : {}),
          });
        }
      }
      observedTransactions.push({
        transactionId: transaction.id,
        status,
        ...(transaction.transactionHash ? { transactionHash: transaction.transactionHash } : {}),
      });
    }

    const actions = await this.recovery.listActions(mission.id);
    for (const action of actions.filter(({ status }) => ambiguousStatuses.has(status))) {
      await this.reconcileAction(action, jobs, transactions);
    }
    const remaining = (await this.recovery.listActions(mission.id)).filter(({ status }) =>
      ambiguousStatuses.has(status),
    );
    const safeToResume = remaining.length === 0;
    return {
      safeToResume,
      details: {
        observedJobs,
        observedTransactions,
        remainingAmbiguousActions: remaining.map(({ actionId }) => actionId),
      },
      ...(safeToResume
        ? {}
        : {
            failureReason: `External outcome cannot be proven for: ${remaining.map(({ actionId }) => actionId).join(', ')}. Side effects will not be repeated automatically.`,
          }),
    };
  }

  private async reconcileAction(
    action: RecoveryAction,
    jobs: Awaited<ReturnType<VirtualsJobRepository['findByMissionId']>>,
    transactions: Awaited<ReturnType<BaseTransactionRepository['findByMissionId']>>,
  ): Promise<void> {
    if (action.kind === 'VIRTUALS_CREATE_JOB') {
      const job = jobs.find(({ actionId }) => actionId === action.actionId);
      if (!job) return;
      await this.recovery.reconcileAction(action.missionId, action.actionId, () =>
        Promise.resolve({
          status: 'COMPLETED',
          receipt: { externalJobId: job.externalJobId, chainId: job.chainId },
          providerReference: job.externalJobId,
        }),
      );
      return;
    }
    if (action.kind.startsWith('VIRTUALS_')) {
      const rootActionId = action.actionId.replace(/:(fund|settle)$/, '');
      const job = jobs.find(({ actionId }) => actionId === rootActionId);
      if (!job) return;
      const snapshot = await this.virtuals.getJob(job.chainId, job.externalJobId);
      const completed =
        action.kind === 'VIRTUALS_FUND_JOB'
          ? ['FUNDED', 'SUBMITTED', 'COMPLETED'].includes(snapshot.state)
          : action.kind === 'VIRTUALS_COMPLETE_JOB'
            ? snapshot.state === 'COMPLETED'
            : action.kind === 'VIRTUALS_REJECT_JOB'
              ? snapshot.state === 'REJECTED'
              : false;
      if (!completed) return;
      await this.recovery.reconcileAction(action.missionId, action.actionId, () =>
        Promise.resolve({
          status: 'COMPLETED',
          receipt: { jobId: job.externalJobId, reconciledState: snapshot.state },
          providerReference: job.externalJobId,
        }),
      );
      return;
    }
    if (action.kind === 'BASE_MISSION_SUCCESS_SETTLEMENT') {
      const transaction = transactions.find(({ actionId }) => actionId === action.actionId);
      if (!transaction?.transactionHash || !this.baseGateway) return;
      const transactionHash = transaction.transactionHash;
      const confirmation = await this.baseGateway.getConfirmation(transactionHash);
      if (!confirmation) return;
      await this.recovery.reconcileAction(action.missionId, action.actionId, () =>
        Promise.resolve(
          confirmation.status === 'success'
            ? {
                status: 'COMPLETED',
                receipt: {
                  transactionHash,
                  chainId: transaction.chainId,
                  blockNumber: confirmation.blockNumber.toString(),
                },
                providerReference: transactionHash,
              }
            : {
                status: 'FAILED',
                failureReason: 'Base transaction reverted during reconciliation',
              },
        ),
      );
    }
  }
}
