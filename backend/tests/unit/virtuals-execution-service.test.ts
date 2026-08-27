import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type {
  VirtualsAgentCandidate,
  VirtualsAgentSource,
  VirtualsJobSnapshot,
} from '../../src/integrations/virtuals/virtuals-agent-source.js';
import { VirtualsExecutionService } from '../../src/integrations/virtuals/virtuals-execution-service.js';
import { VirtualsProtocolError } from '../../src/integrations/virtuals/virtuals-errors.js';
import { MemoryService } from '../../src/memory/memory-service.js';
import type { Mission } from '../../src/missions/mission.js';
import { RecoveryService } from '../../src/recovery/recovery-service.js';
import { VerificationService } from '../../src/verification/verification-service.js';
import { InMemoryRecoveryRepository } from '../support/in-memory-recovery-repository.js';
import { InMemoryVirtualsJobRepository } from '../support/in-memory-virtuals-job-repository.js';
import { MockMemoryProvider } from '../support/mock-memory-provider.js';

const logger = pino({ level: 'silent' });
const mission: Pick<Mission, 'id' | 'objective' | 'constraints' | 'budget'> = {
  id: '00000000-0000-4000-8000-000000000099',
  objective: 'Research and verify X',
  constraints: { output: { format: 'object', requiredFields: ['summary'] }, requiredSources: 1 },
  budget: '1.00',
};
const candidate: VirtualsAgentCandidate = {
  agent: {
    id: 'virtuals:8453:0xabc',
    externalId: '0xabc',
    name: 'ACP Researcher',
    source: 'EXTERNAL_VIRTUALS',
    provider: 'virtuals',
    capabilities: ['research', 'fact-verification'],
    status: 'AVAILABLE',
    cost: { model: 'FIXED', amount: '0.25', currency: 'USDC' },
    metadata: {},
  },
  chainId: 8453,
  providerAddress: '0xabc',
  offeringName: 'research',
  offeringRequirements: {},
};

class MockVirtualsSource implements VirtualsAgentSource {
  readonly provider = 'virtuals' as const;
  readonly createJob = vi.fn().mockResolvedValue('job-99');
  readonly fundJob = vi.fn().mockResolvedValue(undefined);
  readonly completeJob = vi.fn().mockResolvedValue(undefined);
  readonly rejectJob = vi.fn().mockResolvedValue(undefined);
  readonly close = vi.fn().mockResolvedValue(undefined);
  private index = 0;
  constructor(private readonly states: readonly (VirtualsJobSnapshot | Error)[]) {}
  discoverCandidates = vi.fn().mockResolvedValue([candidate]);
  getJob = vi.fn().mockImplementation(() => {
    const value = this.states[Math.min(this.index++, this.states.length - 1)]!;
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve(value);
  });
}

function setup(
  source: MockVirtualsSource,
  options: Partial<{
    maxJobUsdc: number;
    pollIntervalMs: number;
    timeoutMs: number;
    now: () => number;
    sleep: (milliseconds: number) => Promise<void>;
  }> = {},
) {
  const provider = new MockMemoryProvider();
  const memory = new MemoryService(provider, logger);
  const jobs = new InMemoryVirtualsJobRepository();
  const recovery = new RecoveryService(new InMemoryRecoveryRepository(), memory, logger);
  const verification = new VerificationService(memory, logger);
  const service = new VirtualsExecutionService(
    source,
    jobs,
    memory,
    recovery,
    verification,
    logger,
    {
      maxJobUsdc: 0.5,
      pollIntervalMs: 1,
      timeoutMs: 100,
      sleep: () => Promise.resolve(),
      ...options,
    },
  );
  return { service, provider, jobs };
}

describe('VirtualsExecutionService', () => {
  it('funds, verifies, completes, and persists a successful real job flow', async () => {
    const source = new MockVirtualsSource([
      {
        jobId: 'job-99',
        chainId: 8453,
        providerAddress: '0xabc',
        state: 'BUDGET_PROPOSED',
        budget: { amount: '0.25', currency: 'USDC' },
      },
      {
        jobId: 'job-99',
        chainId: 8453,
        providerAddress: '0xabc',
        state: 'SUBMITTED',
        budget: { amount: '0.25', currency: 'USDC' },
        deliverable: '{"summary":"Verified X","sources":["https://example.com"]}',
      },
    ]);
    const { service, provider } = setup(source);
    const result = await service.execute({
      mission,
      actionId: 'execute-1',
      capabilities: ['research', 'fact-verification'],
      requirements: { topic: 'X' },
    });

    expect(result.job.state).toBe('COMPLETED');
    expect(result.job.lifecycle).toMatchObject({
      observedStates: ['CREATED', 'BUDGET_PROPOSED', 'FUNDED', 'SUBMITTED', 'COMPLETED'],
      fundingState: 'FUNDED',
      settlementState: 'COMPLETED',
      proposedBudget: { amount: '0.25', currency: 'USDC' },
    });
    expect(result.verification.passed).toBe(true);
    expect(result.decision.selectedAgent.source).toBe('EXTERNAL_VIRTUALS');
    expect(source.createJob).toHaveBeenCalledOnce();
    expect(source.fundJob).toHaveBeenCalledOnce();
    expect(source.completeJob).toHaveBeenCalledOnce();
    expect(source.rejectJob).not.toHaveBeenCalled();
    expect(
      provider.records.some(
        ({ category, agentProvider }) => category === 'experience' && agentProvider === 'virtuals',
      ),
    ).toBe(true);
  });

  it('rejects a submitted result that fails Continuity verification and records negative experience', async () => {
    const source = new MockVirtualsSource([
      {
        jobId: 'job-99',
        chainId: 8453,
        providerAddress: '0xabc',
        state: 'SUBMITTED',
        deliverable: '{"details":"unsupported"}',
      },
    ]);
    const { service, provider } = setup(source);
    const result = await service.execute({
      mission,
      actionId: 'execute-2',
      capabilities: ['research', 'fact-verification'],
      requirements: { topic: 'X' },
    });

    expect(result.job.state).toBe('REJECTED');
    expect(result.verification.passed).toBe(false);
    expect(source.rejectJob).toHaveBeenCalledOnce();
    expect(
      provider.records.some(
        ({ category, failureReason }) =>
          category === 'failure' && failureReason?.includes('missing'),
      ),
    ).toBe(true);
  });

  it('persists provider failure and writes selection-relevant failure memory', async () => {
    const source = new MockVirtualsSource([
      new VirtualsProtocolError('VIRTUALS_PROVIDER_ERROR', 'provider unavailable', true),
    ]);
    const { service, provider, jobs } = setup(source);
    await expect(
      service.execute({
        mission,
        actionId: 'execute-3',
        capabilities: ['research'],
        requirements: {},
      }),
    ).rejects.toThrow('provider unavailable');
    const job = await jobs.findByMissionAndAction(mission.id, 'execute-3');
    expect(job).toMatchObject({ state: 'FAILED', errorCode: 'VIRTUALS_PROVIDER_ERROR' });
    expect(
      provider.records.some(
        ({ category, failureReason }) =>
          category === 'failure' && failureReason === 'provider unavailable',
      ),
    ).toBe(true);
  });

  it('does not duplicate ACP job creation for the same mission action', async () => {
    const source = new MockVirtualsSource([
      {
        jobId: 'job-99',
        chainId: 8453,
        providerAddress: '0xabc',
        state: 'SUBMITTED',
        deliverable: '{"summary":"Verified X","sources":["https://example.com"]}',
      },
    ]);
    const { service } = setup(source);
    const request = {
      mission,
      actionId: 'execute-4',
      capabilities: ['research'],
      requirements: { topic: 'X' },
    } as const;
    await service.execute(request);
    await service.execute(request);
    expect(source.createJob).toHaveBeenCalledOnce();
    expect(source.completeJob).toHaveBeenCalledOnce();
  });

  it.each(['REJECTED', 'EXPIRED'] as const)('fails closed for terminal %s jobs', async (state) => {
    const source = new MockVirtualsSource([
      { jobId: 'job-99', chainId: 8453, providerAddress: '0xabc', state },
    ]);
    const { service, jobs, provider } = setup(source);
    await expect(
      service.execute({
        mission,
        actionId: `terminal-${state}`,
        capabilities: ['research'],
        requirements: {},
      }),
    ).rejects.toMatchObject({ code: `VIRTUALS_JOB_${state}` });
    await expect(
      jobs.findByMissionAndAction(mission.id, `terminal-${state}`),
    ).resolves.toMatchObject({ state: 'FAILED', errorCode: `VIRTUALS_JOB_${state}` });
    expect(provider.records.some(({ category }) => category === 'failure')).toBe(true);
    expect(source.completeJob).not.toHaveBeenCalled();
  });

  it('rejects an ACP funding proposal above mission or provider budget', async () => {
    const source = new MockVirtualsSource([
      {
        jobId: 'job-99',
        chainId: 8453,
        providerAddress: '0xabc',
        state: 'BUDGET_PROPOSED',
        budget: { amount: '0.75', currency: 'USDC' },
      },
    ]);
    const { service } = setup(source);
    await expect(
      service.execute({
        mission,
        actionId: 'over-budget',
        capabilities: ['research'],
        requirements: {},
      }),
    ).rejects.toMatchObject({ code: 'VIRTUALS_BUDGET_EXCEEDED' });
    expect(source.fundJob).not.toHaveBeenCalled();
  });

  it('marks ambiguous ACP funding uncertain and never funds twice without reconciliation', async () => {
    const source = new MockVirtualsSource([
      {
        jobId: 'job-99',
        chainId: 8453,
        providerAddress: '0xabc',
        state: 'BUDGET_PROPOSED',
        budget: { amount: '0.25', currency: 'USDC' },
      },
    ]);
    source.fundJob.mockRejectedValueOnce(new Error('connection closed after funding request'));
    const { service, jobs } = setup(source);
    const request = {
      mission,
      actionId: 'uncertain-funding',
      capabilities: ['research'],
      requirements: {},
    } as const;

    await expect(service.execute(request)).rejects.toMatchObject({
      code: 'ACTION_OUTCOME_UNCERTAIN',
    });
    await expect(jobs.findByMissionAndAction(mission.id, request.actionId)).resolves.toMatchObject({
      state: 'UNCERTAIN',
      errorCode: 'ACTION_RECONCILIATION_REQUIRED',
    });
    await expect(service.execute(request)).rejects.toMatchObject({
      code: 'ACTION_RECONCILIATION_REQUIRED',
    });
    expect(source.createJob).toHaveBeenCalledOnce();
    expect(source.fundJob).toHaveBeenCalledOnce();
  });

  it('times out bounded polling without settling the job', async () => {
    let clock = 0;
    const source = new MockVirtualsSource([
      { jobId: 'job-99', chainId: 8453, providerAddress: '0xabc', state: 'OPEN' },
    ]);
    const { service } = setup(source, {
      pollIntervalMs: 10,
      timeoutMs: 25,
      now: () => clock,
      sleep: (milliseconds) => {
        clock += milliseconds;
        return Promise.resolve();
      },
    });
    await expect(
      service.execute({
        mission,
        actionId: 'timeout',
        capabilities: ['research'],
        requirements: {},
      }),
    ).rejects.toMatchObject({ code: 'VIRTUALS_JOB_TIMEOUT' });
    expect(source.completeJob).not.toHaveBeenCalled();
    expect(source.rejectJob).not.toHaveBeenCalled();
  });

  it('does not execute an unavailable discovered agent', async () => {
    const source = new MockVirtualsSource([]);
    source.discoverCandidates.mockResolvedValue([
      { ...candidate, agent: { ...candidate.agent, status: 'UNAVAILABLE' } },
    ]);
    const { service } = setup(source);
    await expect(
      service.execute({
        mission,
        actionId: 'unavailable-agent',
        capabilities: ['research'],
        requirements: {},
      }),
    ).rejects.toMatchObject({ code: 'NO_ELIGIBLE_AGENTS' });
    expect(source.createJob).not.toHaveBeenCalled();
  });
});
