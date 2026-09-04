import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { OperatorApprovalService } from '../../src/approvals/operator-approval-service.js';
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
  approvalGranted = true,
) {
  const provider = new MockMemoryProvider();
  const memory = new MemoryService(provider, logger);
  const jobs = new InMemoryVirtualsJobRepository();
  const recovery = new RecoveryService(new InMemoryRecoveryRepository(), memory, logger);
  const verification = new VerificationService(memory, logger);
  const approvals = {
    authorized: vi.fn().mockImplementation((input) =>
      Promise.resolve(
        approvalGranted
          ? {
              ...input,
              id: 'approval-1',
              status: 'APPROVED',
              approvedAt: new Date(),
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          : null,
      ),
    ),
    consume: vi.fn().mockResolvedValue(undefined),
  } as unknown as OperatorApprovalService;
  const service = new VirtualsExecutionService(
    source,
    jobs,
    memory,
    recovery,
    verification,
    logger,
    approvals,
    {
      maxJobUsdc: 0.5,
      pollIntervalMs: 1,
      timeoutMs: 100,
      sleep: () => Promise.resolve(),
      ...options,
    },
  );
  return { service, provider, jobs, approvals };
}

describe('VirtualsExecutionService', () => {
  it('discovers public offerings without invoking ACP lifecycle actions or Sibyl writes', async () => {
    const source = new MockVirtualsSource([]);
    const { service, provider } = setup(source);

    await expect(
      service.discover({
        missionObjective: 'Research and verify X',
        capabilities: ['research'],
        limit: 10,
      }),
    ).resolves.toEqual([candidate]);

    expect(source.discoverCandidates).toHaveBeenCalledWith({
      missionObjective: 'Research and verify X',
      capabilities: ['research'],
      limit: 10,
    });
    expect(source.createJob).not.toHaveBeenCalled();
    expect(source.fundJob).not.toHaveBeenCalled();
    expect(source.completeJob).not.toHaveBeenCalled();
    expect(source.rejectJob).not.toHaveBeenCalled();
    expect(provider.records).toEqual([]);
    expect(provider.events).toEqual([]);
    expect(provider.checkpoints).toEqual([]);
  });

  it('previews only offerings whose schema and price satisfy the persisted mission', async () => {
    const source = new MockVirtualsSource([]);
    const incompatibleCheap = {
      ...candidate,
      agent: {
        ...candidate.agent,
        id: 'virtuals:8453:0xotto',
        externalId: '0xotto',
        name: 'Otto',
        capabilities: ['crypto-news-research'],
        cost: { model: 'FIXED' as const, amount: '0.01', currency: 'USDC' },
      },
      providerAddress: '0xotto',
      offeringName: 'topic_research',
      offeringRequirements: {
        type: 'object',
        required: ['primary_search_term', 'raw_full_user_request', 'initiate_filtered_news_job'],
        properties: {
          primary_search_term: { type: 'string' },
          raw_full_user_request: { type: 'string' },
          initiate_filtered_news_job: { type: 'boolean' },
        },
      },
    };
    const compatible = {
      ...candidate,
      agent: {
        ...candidate.agent,
        id: 'virtuals:8453:0xzizi',
        externalId: '0xzizi',
        name: 'ZIZI',
        capabilities: ['crypto-news-research'],
        cost: { model: 'FIXED' as const, amount: '0.02', currency: 'USDC' },
      },
      providerAddress: '0xzizi',
      offeringName: 'crypto_news_brief',
      offeringRequirements: {
        type: 'object',
        required: ['topic'],
        properties: {
          topic: { type: 'string', minLength: 2 },
          timeframe: { type: 'string', enum: ['24h', '7d'] },
          focus: { type: 'string', enum: ['analysis', 'general'] },
        },
        additionalProperties: false,
      },
    };
    const overBudget = {
      ...compatible,
      agent: {
        ...compatible.agent,
        id: 'virtuals:8453:0xexpensive',
        externalId: '0xexpensive',
        name: 'Expensive',
        cost: { model: 'FIXED' as const, amount: '5', currency: 'USDC' },
      },
      providerAddress: '0xexpensive',
    };
    source.discoverCandidates.mockResolvedValue([incompatibleCheap, compatible, overBudget]);
    const { service } = setup(source);

    const result = await service.preview(
      {
        ...mission,
        budget: '0.10',
        constraints: {
          capabilities: ['crypto-news-research'],
          acpRequirements: {
            topic: 'AI agent payments on Base',
            timeframe: '24h',
            focus: 'analysis',
          },
        },
      },
      ['crypto-news-research'],
      5,
    );

    expect(result.candidates.map(({ offeringName }) => offeringName)).toEqual([
      'crypto_news_brief',
    ]);
    expect(result.decision.selectedAgent.name).toBe('ZIZI');
  });

  it('never creates a job when provider input violates every offering schema', async () => {
    const source = new MockVirtualsSource([]);
    source.discoverCandidates.mockResolvedValue([
      {
        ...candidate,
        offeringRequirements: {
          type: 'object',
          required: ['primary_search_term'],
          properties: { primary_search_term: { type: 'string' } },
        },
      },
    ]);
    const { service } = setup(source);

    await expect(
      service.execute({
        mission,
        actionId: 'invalid-provider-input',
        capabilities: ['research'],
        requirements: { topic: 'AI agent payments on Base' },
      }),
    ).rejects.toMatchObject({ code: 'VIRTUALS_NO_OFFERING' });
    expect(source.createJob).not.toHaveBeenCalled();
  });

  it('pauses at the durable proposal and never funds without exact operator approval', async () => {
    const source = new MockVirtualsSource([
      {
        jobId: 'job-99',
        chainId: 8453,
        providerAddress: '0xabc',
        state: 'BUDGET_PROPOSED',
        budget: { amount: '0.25', currency: 'USDC' },
      },
    ]);
    const { service, jobs } = setup(source, {}, false);
    await expect(
      service.execute({
        mission,
        actionId: 'approval-required',
        capabilities: ['research'],
        requirements: {},
      }),
    ).rejects.toMatchObject({ code: 'VIRTUALS_FUNDING_APPROVAL_REQUIRED' });
    expect(source.fundJob).not.toHaveBeenCalled();
    await expect(
      jobs.findByMissionAndAction(mission.id, 'approval-required'),
    ).resolves.toMatchObject({ state: 'AWAITING_FUNDING_APPROVAL' });
  });

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
    expect(result.job.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.job.provenance).toMatchObject({
      algorithm: 'SHA-256',
      acpJobId: 'job-99',
      offeringId: 'research',
    });
    expect(result.decision.selectedAgent.source).toBe('EXTERNAL_VIRTUALS');
    expect(source.createJob).toHaveBeenCalledOnce();
    expect(source.fundJob).toHaveBeenCalledOnce();
    expect(source.completeJob).toHaveBeenCalledOnce();
    expect(source.rejectJob).not.toHaveBeenCalled();
    expect(
      provider.records.some(
        ({ category, agentProvider, evidenceHash, provenance }) =>
          category === 'experience' &&
          agentProvider === 'virtuals' &&
          /^[a-f0-9]{64}$/.test(evidenceHash ?? '') &&
          provenance?.acpJobId === 'job-99',
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
