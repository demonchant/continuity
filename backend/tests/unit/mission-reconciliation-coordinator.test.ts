import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { BaseTransactionGateway } from '../../src/integrations/base/base-gateway.js';
import type { VirtualsAgentSource } from '../../src/integrations/virtuals/virtuals-agent-source.js';
import { MemoryService } from '../../src/memory/memory-service.js';
import type { Mission } from '../../src/missions/mission.js';
import { MissionReconciliationCoordinator } from '../../src/recovery/mission-reconciliation-coordinator.js';
import { RecoveryService } from '../../src/recovery/recovery-service.js';
import { InMemoryBaseTransactionRepository } from '../support/in-memory-base-transaction-repository.js';
import { InMemoryRecoveryRepository } from '../support/in-memory-recovery-repository.js';
import { InMemoryVirtualsJobRepository } from '../support/in-memory-virtuals-job-repository.js';
import { MockMemoryProvider } from '../support/mock-memory-provider.js';

const logger = pino({ level: 'silent' });
const mission: Mission = {
  id: '00000000-0000-4000-8000-000000000031',
  objective: 'Recover an interrupted verified mission',
  constraints: {},
  budget: '1',
  status: 'RECOVERING',
  currentStep: 'reconcile external state',
  createdAt: new Date('2026-08-27T12:00:00.000Z'),
  updatedAt: new Date('2026-08-27T12:01:00.000Z'),
};
const hash = `0x${'3'.repeat(64)}` as const;

function setup(state: 'COMPLETED' | 'BUDGET_PROPOSED' = 'COMPLETED') {
  const jobs = new InMemoryVirtualsJobRepository();
  const transactions = new InMemoryBaseTransactionRepository();
  const recoveryRepository = new InMemoryRecoveryRepository();
  const recovery = new RecoveryService(
    recoveryRepository,
    new MemoryService(new MockMemoryProvider(), logger),
    logger,
  );
  const createJob = vi.fn().mockResolvedValue('unexpected-job');
  const fundJob = vi.fn().mockResolvedValue(undefined);
  const completeJob = vi.fn().mockResolvedValue(undefined);
  const rejectJob = vi.fn().mockResolvedValue(undefined);
  const sendNativeTransfer = vi.fn().mockResolvedValue(hash);
  const source: VirtualsAgentSource = {
    provider: 'virtuals',
    discoverCandidates: vi.fn().mockResolvedValue([]),
    createJob,
    getJob: vi.fn().mockResolvedValue({
      jobId: 'job-recovery-31',
      chainId: 8453,
      state,
      providerAddress: '0x3333333333333333333333333333333333333333',
      deliverable: '{"summary":"persisted"}',
    }),
    fundJob,
    completeJob,
    rejectJob,
    close: vi.fn().mockResolvedValue(undefined),
  };
  const gateway: BaseTransactionGateway = {
    network: 'base-sepolia',
    chainId: 84532,
    explorerBaseUrl: 'https://sepolia.basescan.org',
    sendNativeTransfer,
    sendTokenTransfer: vi.fn().mockResolvedValue(hash),
    waitForConfirmation: vi.fn().mockResolvedValue({
      transactionHash: hash,
      status: 'success',
      blockNumber: 3100n,
    }),
    getConfirmation: vi.fn().mockResolvedValue({
      transactionHash: hash,
      status: 'success',
      blockNumber: 3100n,
    }),
  };
  const coordinator = new MissionReconciliationCoordinator(
    recovery,
    source,
    jobs,
    transactions,
    gateway,
  );
  return {
    coordinator,
    jobs,
    transactions,
    recovery,
    source,
    gateway,
    mocks: { createJob, fundJob, completeJob, rejectJob, sendNativeTransfer },
  };
}

async function makeUncertain(
  recovery: RecoveryService,
  actionId: string,
  kind: string,
  paymentId?: string,
): Promise<void> {
  await expect(
    recovery.executeCriticalAction(
      { missionId: mission.id, actionId, kind, ...(paymentId ? { paymentId } : {}) },
      () => Promise.reject(new Error('controlled process interruption')),
    ),
  ).rejects.toMatchObject({ code: 'ACTION_OUTCOME_UNCERTAIN' });
}

describe('MissionReconciliationCoordinator', () => {
  it('reconciles persisted Virtuals and Base receipts without repeating side effects', async () => {
    const { coordinator, jobs, transactions, recovery, mocks } = setup();
    const rootAction = `mission:${mission.id}:agent-attempt:1`;
    await jobs.createOrGet({
      missionId: mission.id,
      actionId: rootAction,
      externalJobId: 'job-recovery-31',
      chainId: 8453,
      agentId: 'virtuals:8453:agent-31',
      providerAddress: '0x3333333333333333333333333333333333333333',
      offeringName: 'research',
      requirement: {},
    });
    await makeUncertain(recovery, rootAction, 'VIRTUALS_CREATE_JOB');
    await makeUncertain(
      recovery,
      `${rootAction}:fund`,
      'VIRTUALS_FUND_JOB',
      'virtuals:8453:job-recovery-31:fund',
    );
    await makeUncertain(recovery, `${rootAction}:settle`, 'VIRTUALS_COMPLETE_JOB');

    const baseAction = `mission:${mission.id}:base-success-settlement`;
    const transaction = await transactions.createOrGet({
      missionId: mission.id,
      actionId: baseAction,
      paymentId: `mission-success-settlement:${mission.id}`,
      agentId: 'virtuals:8453:agent-31',
      network: 'base-sepolia',
      chainId: 84532,
      action: 'MISSION_SUCCESS_SETTLEMENT',
      verificationId: 'verification-31',
      recipient: '0x3333333333333333333333333333333333333333',
      amount: '0.00001',
      asset: 'ETH',
    });
    await transactions.update({ id: transaction.id, status: 'SUBMITTED', transactionHash: hash });
    await makeUncertain(
      recovery,
      baseAction,
      'BASE_MISSION_SUCCESS_SETTLEMENT',
      `mission-success-settlement:${mission.id}`,
    );

    await expect(coordinator.reconcile(mission)).resolves.toMatchObject({
      safeToResume: true,
      details: { remainingAmbiguousActions: [] },
    });
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.fundJob).not.toHaveBeenCalled();
    expect(mocks.completeJob).not.toHaveBeenCalled();
    expect(mocks.rejectJob).not.toHaveBeenCalled();
    expect(mocks.sendNativeTransfer).not.toHaveBeenCalled();
    await expect(transactions.findById(transaction.id)).resolves.toMatchObject({
      status: 'CONFIRMED',
      transactionHash: hash,
      blockNumber: 3100n,
    });
    expect(
      (await recovery.listActions(mission.id)).every(({ status }) => status === 'COMPLETED'),
    ).toBe(true);
  });

  it('blocks ambiguous external calls when no durable external identifier exists', async () => {
    const { coordinator, recovery, mocks } = setup('BUDGET_PROPOSED');
    await makeUncertain(recovery, `mission:${mission.id}:agent-attempt:1`, 'VIRTUALS_CREATE_JOB');
    await makeUncertain(
      recovery,
      `mission:${mission.id}:base-success-settlement`,
      'BASE_MISSION_SUCCESS_SETTLEMENT',
      `mission-success-settlement:${mission.id}`,
    );

    await expect(coordinator.reconcile(mission)).resolves.toMatchObject({
      safeToResume: false,
      failureReason: expect.stringContaining('External outcome cannot be proven'),
    });
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.sendNativeTransfer).not.toHaveBeenCalled();
  });
});
