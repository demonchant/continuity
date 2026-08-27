import pino from 'pino';
import { describe, expect, it } from 'vitest';
import type { LocalTestAgent } from '../../src/agents/agent.js';
import { InMemoryAgentRegistry } from '../../src/agents/agent-registry.js';
import { DecisionEngine } from '../../src/decisions/decision-engine.js';
import { DisabledMemoryProvider } from '../../src/memory/memory-provider.js';
import type { MemoryRecord, RecalledMemory } from '../../src/memory/memory-record.js';
import { MemoryService } from '../../src/memory/memory-service.js';
import { MockMemoryProvider } from '../support/mock-memory-provider.js';

const now = new Date('2026-08-21T12:00:00.000Z');
const mission = {
  id: '00000000-0000-4000-8000-000000000005',
  objective: 'Research and verify information about X',
};

function agent(id: 'agent-a' | 'agent-b', amount: string): LocalTestAgent {
  return {
    id,
    name: `[LOCAL TEST] ${id === 'agent-a' ? 'Agent A' : 'Agent B'}`,
    source: 'LOCAL_TEST',
    provider: 'local-test',
    capabilities: ['research', 'fact-verification'],
    status: 'AVAILABLE',
    cost: { model: 'FIXED', amount, currency: 'USD' },
    metadata: { synthetic: true },
  };
}

function registry(costA = '0.10', costB = '0.50'): InMemoryAgentRegistry {
  const result = new InMemoryAgentRegistry();
  result.register(agent('agent-a', costA));
  result.register(agent('agent-b', costB));
  return result;
}

function memoryRecord(
  id: string,
  agentId: 'agent-a' | 'agent-b',
  outcome: 'success' | 'failure',
): RecalledMemory {
  const passed = outcome === 'success';
  const record: MemoryRecord = {
    schemaVersion: 1,
    id,
    category: passed ? 'outcome' : 'failure',
    timestamp: '2026-08-20T12:00:00.000Z',
    missionId: `prior-${id}`,
    mission: 'Research and verify information about X',
    capability: 'fact-verification',
    agentId,
    agentProvider: 'local-test',
    result: passed ? 'Verified research completed' : 'Unsupported claims returned',
    verification: {
      status: passed ? 'PASS' : 'FAIL',
      summary: passed ? 'All claims supported' : 'Unsupported claims',
      verifierVersion: '1',
    },
    success: passed,
    ...(passed ? {} : { failureReason: 'Unsupported claims' }),
    recommendation: passed
      ? `Prefer ${agentId} for comparable verified research`
      : `Avoid ${agentId} for comparable verification work`,
  };
  return { record, sibylRecordId: `sibyl-${id}`, sibylTier: 'entity' };
}

function service(provider: MockMemoryProvider): MemoryService {
  return new MemoryService(provider, pino({ level: 'silent' }), {
    now: () => now,
    id: () => 'stored-decision',
  });
}

describe('DecisionEngine memory-driven selection', () => {
  it('has no experience-based preference when no historical experience exists', async () => {
    const provider = new MockMemoryProvider();
    const decision = await new DecisionEngine(registry('0.20', '0.20'), service(provider), {
      now: () => now,
    }).decide(mission);

    expect(decision.selectedAgent.id).toBe('agent-a');
    expect(decision.reason).toContain('no experience-based preference');
    expect(decision.memoryReferences).toEqual([]);
    expect(decision.evidence.map(({ historicalScore }) => historicalScore)).toEqual([0.425, 0.425]);
    expect(decision.evidence.every(({ metrics }) => metrics.observationCount === 0)).toBe(true);
  });

  it('penalizes a cheaper agent with relevant failure memory', async () => {
    const provider = new MockMemoryProvider();
    provider.searchResult = [memoryRecord('failure-a', 'agent-a', 'failure')];

    const decision = await new DecisionEngine(registry(), service(provider), {
      now: () => now,
    }).decide(mission);

    expect(decision.selectedAgent.id).toBe('agent-b');
    expect(decision.reason).toContain('Sibyl evidence penalized');
    expect(decision.reason).toContain('Unsupported claims');
    expect(decision.alternatives[0]).toMatchObject({
      agent: { id: 'agent-a' },
      memoryReferences: ['sibyl-failure-a'],
    });
    expect(decision.evidence.find(({ agentId }) => agentId === 'agent-a')).toMatchObject({
      metrics: {
        observationCount: 1,
        successRate: 0,
        verificationSuccessRate: 0,
        failurePatterns: [{ reason: 'Unsupported claims', count: 1 }],
      },
    });
  });

  it('favors an agent with relevant verified success memory', async () => {
    const provider = new MockMemoryProvider();
    provider.searchResult = [memoryRecord('success-b', 'agent-b', 'success')];

    const decision = await new DecisionEngine(registry('0.20', '0.20'), service(provider), {
      now: () => now,
    }).decide(mission);

    expect(decision.selectedAgent.id).toBe('agent-b');
    expect(decision.reason).toContain('success rate 1');
    expect(decision.reason).toContain('verification success 1');
    expect(decision.memoryReferences).toEqual(['sibyl-success-b']);
  });

  it('cites historical evidence and stores the explained decision back in Sibyl', async () => {
    const provider = new MockMemoryProvider();
    provider.searchResult = [
      memoryRecord('failure-a', 'agent-a', 'failure'),
      memoryRecord('success-b', 'agent-b', 'success'),
    ];

    const decision = await new DecisionEngine(registry(), service(provider), {
      now: () => now,
    }).decide(mission);

    expect(decision.selectedAgent.id).toBe('agent-b');
    expect(decision.memoryReferences).toEqual(['sibyl-failure-a', 'sibyl-success-b']);
    expect(decision.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentId: 'agent-a', memoryReferences: ['sibyl-failure-a'] }),
        expect.objectContaining({ agentId: 'agent-b', memoryReferences: ['sibyl-success-b'] }),
      ]),
    );
    expect(provider.records.at(-1)).toMatchObject({
      category: 'decision',
      agentId: 'agent-b',
      decisionReason: expect.stringContaining('Sibyl outcomes'),
      memoryReferences: ['sibyl-failure-a', 'sibyl-success-b'],
    });
    expect(provider.events.at(-1)?.category).toBe('decision');
    expect(decision.decisionMemoryId).toBe('continuity-stored-decision');
  });

  it('deletion test removes historical behavior instead of replacing Sibyl', async () => {
    const withMemoryProvider = new MockMemoryProvider();
    withMemoryProvider.searchResult = [memoryRecord('failure-a', 'agent-a', 'failure')];
    const withMemory = await new DecisionEngine(registry(), service(withMemoryProvider), {
      now: () => now,
    }).decide(mission);

    const withoutMemory = await new DecisionEngine(
      registry(),
      new MemoryService(new DisabledMemoryProvider(), pino({ level: 'silent' })),
      { now: () => now },
    ).decide(mission);

    expect(withMemory.selectedAgent.id).toBe('agent-b');
    expect(withMemory.memoryReferences).toEqual(['sibyl-failure-a']);
    expect(withoutMemory).toMatchObject({
      selectedAgent: { id: 'agent-a' },
      historicalExperience: 'unavailable',
      confidence: 0.1,
      memoryReferences: [],
    });
    expect(withoutMemory.reason).toContain('Sibyl historical experience was unavailable');
    expect(withoutMemory).not.toHaveProperty('decisionMemoryId');
  });
});
