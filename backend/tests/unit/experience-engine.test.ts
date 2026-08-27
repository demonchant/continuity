import pino from 'pino';
import { describe, expect, it } from 'vitest';
import type { LocalTestAgent } from '../../src/agents/agent.js';
import { InMemoryAgentRegistry } from '../../src/agents/agent-registry.js';
import { DecisionEngine } from '../../src/decisions/decision-engine.js';
import { ExperienceEngine } from '../../src/experience/experience-engine.js';
import type { MemoryRecord, RecalledMemory } from '../../src/memory/memory-record.js';
import { MemoryService } from '../../src/memory/memory-service.js';
import { MockMemoryProvider } from '../support/mock-memory-provider.js';

const now = new Date('2026-08-21T12:00:00.000Z');

interface ObservationOptions {
  readonly id: string;
  readonly agentId: 'agent-a' | 'agent-b';
  readonly capability: 'summarization' | 'fact-verification';
  readonly success: boolean;
  readonly mission?: string;
  readonly timestamp?: string;
  readonly cost?: string;
  readonly latencyMs?: number;
}

function observation(options: ObservationOptions): RecalledMemory {
  const record: MemoryRecord = {
    schemaVersion: 1,
    id: options.id,
    category: options.success ? 'experience' : 'failure',
    timestamp: options.timestamp ?? '2026-08-20T12:00:00.000Z',
    missionId: `mission-${options.id}`,
    mission: options.mission ?? 'Research and verify information about X',
    capability: options.capability,
    agentId: options.agentId,
    agentProvider: 'local-test',
    result: options.success ? 'Verified result accepted' : 'Unsupported claims rejected',
    verification: {
      status: options.success ? 'PASS' : 'FAIL',
      summary: options.success ? 'Requirements passed' : 'Unsupported claims',
      verifierVersion: 'continuity-deterministic-v1',
    },
    success: options.success,
    ...(options.success ? {} : { failureReason: 'Unsupported claims' }),
    ...(options.cost ? { cost: { amount: options.cost, currency: 'USD' } } : {}),
    ...(options.latencyMs !== undefined ? { latencyMs: options.latencyMs } : {}),
  };
  return { record, sibylRecordId: `sibyl-${options.id}`, sibylTier: 'entity' };
}

function agent(id: 'agent-a' | 'agent-b'): LocalTestAgent {
  return {
    id,
    name: `[LOCAL TEST] ${id}`,
    source: 'LOCAL_TEST',
    provider: 'local-test',
    capabilities: ['summarization', 'fact-verification'],
    status: 'AVAILABLE',
    cost: { model: 'FIXED', amount: '0.25', currency: 'USD' },
    metadata: { synthetic: true },
  };
}

function registry(): InMemoryAgentRegistry {
  const result = new InMemoryAgentRegistry();
  result.register(agent('agent-a'));
  result.register(agent('agent-b'));
  return result;
}

async function decide(
  memories: readonly RecalledMemory[],
  objective: string,
  capability: 'summarization' | 'fact-verification',
) {
  const provider = new MockMemoryProvider();
  provider.searchResult = memories;
  const memory = new MemoryService(provider, pino({ level: 'silent' }), {
    now: () => now,
    id: () => 'experience-decision',
  });
  return new DecisionEngine(registry(), memory, { now: () => now }).decide(
    { id: `new-${capability}`, objective },
    [capability],
  );
}

describe('ExperienceEngine', () => {
  it('summarizes negative memory, verification, cost, latency, and mission similarity', () => {
    const profile = new ExperienceEngine().evaluate({
      agentId: 'agent-a',
      capabilities: ['fact-verification'],
      mission: 'Research and verify information about X',
      memories: [
        observation({
          id: 'failure-1',
          agentId: 'agent-a',
          capability: 'fact-verification',
          success: false,
          cost: '0.20',
          latencyMs: 1000,
        }),
        observation({
          id: 'failure-2',
          agentId: 'agent-a',
          capability: 'fact-verification',
          success: false,
          cost: '0.40',
          latencyMs: 2000,
        }),
      ],
      asOf: now,
    }).profiles[0]!;

    expect(profile).toMatchObject({
      agentId: 'agent-a',
      capability: 'fact-verification',
      observationCount: 2,
      successCount: 0,
      failureCount: 2,
      successRate: 0,
      verificationSuccessRate: 0,
      similarMissionOutcomes: 2,
      similarMissionSuccessRate: 0,
      recentOutcomeRate: 0,
      averageCost: { amount: '0.3', currency: 'USD' },
      averageLatencyMs: 1500,
      failurePatterns: [{ reason: 'Unsupported claims', count: 2 }],
      memoryReferences: ['sibyl-failure-1', 'sibyl-failure-2'],
    });
    expect(profile.recommendation).toContain(
      'agent-a failed verification on 2 similar fact-verification missions',
    );
    expect(profile.confidence).toBeGreaterThan(0);
    expect(profile.observedFrom).toBe('2026-08-20T12:00:00.000Z');
  });

  it('successful experience changes future selection', async () => {
    const decision = await decide(
      [
        observation({
          id: 'success-b',
          agentId: 'agent-b',
          capability: 'fact-verification',
          success: true,
        }),
      ],
      'Research and verify information about X',
      'fact-verification',
    );

    expect(decision.selectedAgent.id).toBe('agent-b');
    expect(decision.memoryReferences).toEqual(['sibyl-success-b']);
  });

  it('failure experience changes future selection', async () => {
    const decision = await decide(
      [
        observation({
          id: 'failure-a',
          agentId: 'agent-a',
          capability: 'fact-verification',
          success: false,
        }),
      ],
      'Research and verify information about X',
      'fact-verification',
    );

    expect(decision.selectedAgent.id).toBe('agent-b');
    expect(decision.reason).toContain('Sibyl evidence penalized');
  });

  it('respects capability-specific experience for the same agent', async () => {
    const memories = [
      observation({
        id: 'a-summary-success',
        agentId: 'agent-a',
        capability: 'summarization',
        success: true,
        mission: 'Summarize the quarterly finance report',
      }),
      observation({
        id: 'a-verification-failure',
        agentId: 'agent-a',
        capability: 'fact-verification',
        success: false,
      }),
      observation({
        id: 'b-summary-failure',
        agentId: 'agent-b',
        capability: 'summarization',
        success: false,
        mission: 'Summarize the quarterly finance report',
      }),
      observation({
        id: 'b-verification-success',
        agentId: 'agent-b',
        capability: 'fact-verification',
        success: true,
      }),
    ];

    const summaryDecision = await decide(
      memories,
      'Summarize the quarterly finance report',
      'summarization',
    );
    const verificationDecision = await decide(
      memories,
      'Research and verify information about X',
      'fact-verification',
    );

    expect(summaryDecision.selectedAgent.id).toBe('agent-a');
    expect(verificationDecision.selectedAgent.id).toBe('agent-b');
    expect(summaryDecision.memoryReferences).not.toContain('sibyl-a-verification-failure');
    expect(verificationDecision.memoryReferences).not.toContain('sibyl-a-summary-success');
  });

  it('prevents stale unrelated successes from dominating recent similar failure evidence', async () => {
    const staleSuccesses = Array.from({ length: 12 }, (_, index) =>
      observation({
        id: `stale-unrelated-${index}`,
        agentId: 'agent-a',
        capability: 'fact-verification',
        success: true,
        mission: 'Translate archived legal documents into French',
        timestamp: '2024-01-01T12:00:00.000Z',
      }),
    );
    const decision = await decide(
      [
        ...staleSuccesses,
        observation({
          id: 'recent-similar-failure',
          agentId: 'agent-a',
          capability: 'fact-verification',
          success: false,
        }),
      ],
      'Research and verify information about X',
      'fact-verification',
    );

    expect(decision.selectedAgent.id).toBe('agent-b');
    const profile = decision.evidence.find(({ agentId }) => agentId === 'agent-a')!
      .capabilityProfiles[0]!;
    expect(profile.staleObservationCount).toBe(12);
    expect(profile.effectiveSampleSize).toBeLessThan(3);
    expect(profile.recommendation).toContain('failed verification on 1 similar');
  });
});
