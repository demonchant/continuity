import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { RecalledMemory } from '../../src/memory/memory-record.js';
import type { ProviderRecallQuery } from '../../src/memory/memory-provider.js';
import { MemoryService } from '../../src/memory/memory-service.js';
import { MissionService } from '../../src/missions/mission-service.js';
import { RecoveryService } from '../../src/recovery/recovery-service.js';
import { VerificationService } from '../../src/verification/verification-service.js';
import type {
  VirtualsAgentCandidate,
  VirtualsAgentSource,
  VirtualsJobSnapshot,
} from '../../src/integrations/virtuals/virtuals-agent-source.js';
import { VirtualsExecutionService } from '../../src/integrations/virtuals/virtuals-execution-service.js';
import type {
  BaseConfirmation,
  BaseTokenTransferRequest,
  BaseTransactionGateway,
  TransactionHash,
} from '../../src/integrations/base/base-gateway.js';
import { BasePaymentService } from '../../src/integrations/base/base-payment-service.js';
import { MissionRunner } from '../../src/runner/mission-runner.js';
import { InMemoryBaseTransactionRepository } from '../support/in-memory-base-transaction-repository.js';
import { InMemoryMissionRepository } from '../support/in-memory-mission-repository.js';
import { InMemoryRecoveryRepository } from '../support/in-memory-recovery-repository.js';
import { InMemoryVirtualsJobRepository } from '../support/in-memory-virtuals-job-repository.js';
import { MockMemoryProvider } from '../support/mock-memory-provider.js';

const logger = pino({ level: 'silent' });
const agentAAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const agentBAddress = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const transactionHash: TransactionHash = `0x${'1'.repeat(64)}`;

function candidate(
  id: string,
  name: string,
  address: string,
  amount: string,
): VirtualsAgentCandidate {
  return {
    agent: {
      id,
      externalId: address,
      name,
      source: 'EXTERNAL_VIRTUALS',
      provider: 'virtuals',
      capabilities: ['research', 'fact-verification'],
      status: 'AVAILABLE',
      cost: { model: 'FIXED', amount, currency: 'USDC' },
      metadata: { testDouble: true },
    },
    chainId: 84532,
    providerAddress: address,
    offeringName: 'verified-research',
    offeringRequirements: {},
  };
}

class LearningMemoryProvider extends MockMemoryProvider {
  override search(query: ProviderRecallQuery): Promise<readonly RecalledMemory[]> {
    this.searches.push(query);
    return Promise.resolve(
      this.records
        .filter(({ category }) => !query.categories || query.categories.includes(category))
        .slice(-query.limit)
        .map((record) => ({
          record,
          sibylRecordId: `sibyl-record-${record.id}`,
          sibylTier: 'WARM',
        })),
    );
  }
}

class LifecycleVirtualsSource implements VirtualsAgentSource {
  readonly provider = 'virtuals' as const;
  readonly candidates = [
    candidate('virtuals-agent-a', 'Cheaper Agent A', agentAAddress, '0.50'),
    candidate('virtuals-agent-b', 'Reliable Agent B', agentBAddress, '0.80'),
  ];
  readonly discoverCandidates = vi.fn().mockResolvedValue(this.candidates);
  readonly fundJob = vi.fn().mockResolvedValue(undefined);
  readonly completeJob = vi.fn().mockResolvedValue(undefined);
  readonly rejectJob = vi.fn().mockResolvedValue(undefined);
  readonly close = vi.fn().mockResolvedValue(undefined);
  readonly createJob = vi
    .fn()
    .mockImplementation(({ providerAddress }: { providerAddress: string }) =>
      Promise.resolve(providerAddress === agentAAddress ? 'job-agent-a' : 'job-agent-b'),
    );

  getJob(_chainId: number, jobId: string): Promise<VirtualsJobSnapshot> {
    const failed = jobId === 'job-agent-a';
    return Promise.resolve({
      jobId,
      chainId: 84532,
      providerAddress: failed ? agentAAddress : agentBAddress,
      state: 'SUBMITTED',
      deliverable: failed
        ? '{"details":"unsupported assertion"}'
        : '{"summary":"Verified result for X","sources":["https://example.com/evidence"]}',
      budget: { amount: failed ? '0.50' : '0.80', currency: 'USDC' },
    });
  }
}

class ConfirmingBaseGateway implements BaseTransactionGateway {
  readonly network = 'base-sepolia' as const;
  readonly chainId = 84532;
  readonly explorerBaseUrl = 'https://sepolia.basescan.org';
  readonly sendTokenTransfer = vi.fn(
    (_request: BaseTokenTransferRequest): Promise<TransactionHash> =>
      Promise.resolve(transactionHash),
  );
  readonly sendNativeTransfer = vi.fn((): Promise<TransactionHash> =>
    Promise.resolve(transactionHash),
  );
  readonly waitForConfirmation = vi.fn((): Promise<BaseConfirmation> =>
    Promise.resolve({ transactionHash, status: 'success', blockNumber: 123n }),
  );
  readonly getConfirmation = vi.fn(() => Promise.resolve(null));
}

describe('complete autonomous mission lifecycle', () => {
  it('uses fresh Sibyl failure experience to choose a fallback, verifies it, and confirms Base', async () => {
    const provider = new LearningMemoryProvider();
    const memory = new MemoryService(provider, logger, {
      now: () => new Date('2026-08-22T12:00:00.000Z'),
    });
    const missions = new MissionService(new InMemoryMissionRepository());
    const recovery = new RecoveryService(new InMemoryRecoveryRepository(), memory, logger);
    const source = new LifecycleVirtualsSource();
    const virtuals = new VirtualsExecutionService(
      source,
      new InMemoryVirtualsJobRepository(),
      memory,
      recovery,
      new VerificationService(memory, logger),
      logger,
      { maxJobUsdc: 1, pollIntervalMs: 1, timeoutMs: 1_000, sleep: () => Promise.resolve() },
    );
    const baseGateway = new ConfirmingBaseGateway();
    const base = new BasePaymentService(
      baseGateway,
      new InMemoryBaseTransactionRepository(),
      recovery,
      memory,
      logger,
      {
        recipient: agentBAddress,
        maxPaymentAmount: '1.00',
        confirmations: 1,
        asset: 'USDC',
        tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      },
    );
    const mission = await missions.create({
      objective: 'Research and verify information about X',
      constraints: {
        output: { format: 'object', requiredFields: ['summary'] },
        requiredSources: 1,
        baseAction: {
          required: true,
          purpose: 'MISSION_SUCCESS_SETTLEMENT',
          amount: '0.10',
          asset: 'USDC',
        },
        budgetCurrency: 'USDC',
        runner: { maximumRetries: 2, failureThreshold: 2, timeoutMs: 60_000 },
      },
      budget: '2.00',
    });
    const runner = new MissionRunner(missions, virtuals, base, memory, recovery, logger, {
      maximumRetries: 3,
      failureThreshold: 3,
      timeoutMs: 120_000,
      candidateLimit: 10,
    });

    const result = await runner.run(mission.id);

    expect(result.mission.status).toBe('COMPLETED');
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]).toMatchObject({
      agentId: 'virtuals-agent-a',
      status: 'VERIFICATION_FAILED',
    });
    expect(result.attempts[1]).toMatchObject({
      agentId: 'virtuals-agent-b',
      status: 'VERIFIED',
      decision: {
        memoryReferences: expect.arrayContaining([expect.stringContaining('sibyl-record-')]),
      },
    });
    expect(result.selectedAgentId).toBe('virtuals-agent-b');
    expect(result.baseTransaction).toMatchObject({
      transactionHash,
      status: 'CONFIRMED',
      amount: '0.10',
      action: 'MISSION_SUCCESS_SETTLEMENT',
      asset: 'USDC',
    });
    expect(source.rejectJob).toHaveBeenCalledOnce();
    expect(source.completeJob).toHaveBeenCalledOnce();
    expect(baseGateway.sendTokenTransfer).toHaveBeenCalledOnce();
    expect(baseGateway.sendTokenTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ amountBaseUnits: 100000n }),
    );
    expect(provider.searches.length).toBeGreaterThanOrEqual(3);
    expect(provider.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'failure',
          agentId: 'virtuals-agent-a',
          capability: 'fact-verification',
        }),
        expect.objectContaining({
          category: 'experience',
          agentId: 'virtuals-agent-b',
          success: true,
        }),
        expect.objectContaining({
          category: 'outcome',
          providerReference: transactionHash,
        }),
      ]),
    );
    expect(provider.checkpoints.at(-1)?.record.recovery).toMatchObject({
      missionState: 'COMPLETED',
      paymentStatus: 'COMPLETED',
      verificationStatus: 'PASS',
      nextAction: 'none',
    });
  });

  it('stops at the failure threshold instead of entering an autonomous loop', async () => {
    const provider = new LearningMemoryProvider();
    const memory = new MemoryService(provider, logger);
    const missions = new MissionService(new InMemoryMissionRepository());
    const recovery = new RecoveryService(new InMemoryRecoveryRepository(), memory, logger);
    const execute = vi.fn().mockRejectedValue(new Error('provider unavailable'));
    const mission = await missions.create({
      objective: 'Research and verify information about X',
      constraints: { runner: { maximumRetries: 5, failureThreshold: 2 } },
      budget: '1.00',
    });
    const runner = new MissionRunner(
      missions,
      { execute } as unknown as VirtualsExecutionService,
      undefined,
      memory,
      recovery,
      logger,
      { maximumRetries: 3, failureThreshold: 3, timeoutMs: 120_000, candidateLimit: 10 },
    );

    await expect(runner.run(mission.id)).rejects.toMatchObject({ code: 'MISSION_RUN_FAILED' });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(await missions.get(mission.id)).toMatchObject({ status: 'FAILED' });
    expect(provider.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'failure',
          tags: ['autonomous-mission', 'terminal-failure'],
        }),
      ]),
    );
  });
});
