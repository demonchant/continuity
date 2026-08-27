import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type {
  VirtualsExecutionResult,
  VirtualsExecutionService,
} from '../../src/integrations/virtuals/virtuals-execution-service.js';
import { DisabledMemoryProvider } from '../../src/memory/memory-provider.js';
import { MemoryService } from '../../src/memory/memory-service.js';
import { MissionService } from '../../src/missions/mission-service.js';
import type { RecoveryService } from '../../src/recovery/recovery-service.js';
import { MissionRunner } from '../../src/runner/mission-runner.js';
import { InMemoryMissionRepository } from '../support/in-memory-mission-repository.js';
import { MockMemoryProvider } from '../support/mock-memory-provider.js';

const logger = pino({ level: 'silent' });

function executionResult(): VirtualsExecutionResult {
  return {
    decision: {
      selectedAgent: {
        id: 'virtuals:8453:agent-b',
        externalId: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        name: 'Agent B',
        source: 'EXTERNAL_VIRTUALS',
        provider: 'virtuals',
        capabilities: ['research'],
        status: 'AVAILABLE',
        cost: { model: 'FIXED', amount: '0.50', currency: 'USDC' },
        metadata: {},
      },
      reason: 'Selected after Sibyl recall',
      confidence: 0.8,
      evidence: [],
      alternatives: [],
      memoryReferences: [],
      historicalExperience: 'available',
    },
    job: {
      id: '00000000-0000-4000-8000-000000001703',
      missionId: 'placeholder',
      actionId: 'placeholder',
      externalJobId: 'job-1703',
      chainId: 8453,
      agentId: 'virtuals:8453:agent-b',
      providerAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      offeringName: 'research',
      requirement: {},
      state: 'COMPLETED',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    verification: {
      id: 'verification-1703',
      verifierVersion: 'continuity-deterministic-v1',
      passed: true,
      score: 1,
      reasons: ['All requirements passed.'],
      failedRequirements: [],
      checks: [],
      memoryRecordId: 'memory-1703',
    },
    cost: { amount: '0.50', currency: 'USDC' },
    lifecycle: {
      observedStates: ['CREATED', 'SUBMITTED', 'COMPLETED'],
      initialState: 'CREATED',
      fundingState: 'NOT_REQUIRED',
      settlementState: 'COMPLETED',
      deliverable: { summary: 'done' },
    },
  };
}

function runner(options: {
  readonly missions: MissionService;
  readonly memory: MemoryService;
  readonly execute?: ReturnType<typeof vi.fn>;
  readonly now?: () => number;
}) {
  const execute = options.execute ?? vi.fn().mockResolvedValue(executionResult());
  const checkpoint = vi.fn().mockResolvedValue({});
  return {
    execute,
    checkpoint,
    service: new MissionRunner(
      options.missions,
      { execute } as unknown as VirtualsExecutionService,
      undefined,
      options.memory,
      { checkpoint } as unknown as RecoveryService,
      logger,
      {
        maximumRetries: 1,
        timeoutMs: 60_000,
        failureThreshold: 2,
        candidateLimit: 5,
        ...(options.now ? { now: options.now } : {}),
      },
    ),
  };
}

async function mission(missions: MissionService, timeoutMs = 60_000) {
  return missions.create({
    objective: 'Research official information about X',
    constraints: {
      capabilities: ['research'],
      runner: { maximumRetries: 0, failureThreshold: 1, timeoutMs },
    },
    budget: '1.00',
  });
}

describe('Phase 17 hostile autonomous runner boundaries', () => {
  it('refuses repeated execution of an already completed mission', async () => {
    const missions = new MissionService(new InMemoryMissionRepository());
    const provider = new MockMemoryProvider();
    const subject = runner({ missions, memory: new MemoryService(provider, logger) });
    const created = await mission(missions);

    await expect(subject.service.run(created.id)).resolves.toMatchObject({
      mission: { status: 'COMPLETED' },
    });
    await expect(subject.service.run(created.id)).rejects.toMatchObject({
      code: 'MISSION_ALREADY_TERMINAL',
      statusCode: 409,
    });
    expect(subject.execute).toHaveBeenCalledOnce();
  });

  it('fails the mission when load-bearing Sibyl recall is missing', async () => {
    const missions = new MissionService(new InMemoryMissionRepository());
    const subject = runner({
      missions,
      memory: new MemoryService(new DisabledMemoryProvider(), logger),
    });
    const created = await mission(missions);

    await expect(subject.service.run(created.id)).rejects.toMatchObject({
      code: 'MISSION_RUN_FAILED',
      message: expect.stringContaining('Required Sibyl recall failed'),
    });
    await expect(missions.get(created.id)).resolves.toMatchObject({ status: 'FAILED' });
    expect(subject.execute).not.toHaveBeenCalled();
  });

  it('enforces mission timeout before starting external execution', async () => {
    const missions = new MissionService(new InMemoryMissionRepository());
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValue(1_000);
    const subject = runner({
      missions,
      memory: new MemoryService(new MockMemoryProvider(), logger),
      now: clock,
    });
    const created = await mission(missions, 1_000);

    await expect(subject.service.run(created.id)).rejects.toMatchObject({
      code: 'MISSION_RUN_FAILED',
      message: 'Autonomous mission exceeded its configured timeout',
    });
    expect(subject.execute).not.toHaveBeenCalled();
  });
});
