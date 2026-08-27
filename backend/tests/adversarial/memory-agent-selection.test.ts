import pino from 'pino';
import { describe, expect, it } from 'vitest';
import type { LocalTestAgent } from '../../src/agents/agent.js';
import { InMemoryAgentRegistry } from '../../src/agents/agent-registry.js';
import { DecisionEngine } from '../../src/decisions/decision-engine.js';
import { DisabledMemoryProvider } from '../../src/memory/memory-provider.js';
import type { MemoryRecord, RecalledMemory } from '../../src/memory/memory-record.js';
import { MemoryService } from '../../src/memory/memory-service.js';
import { MockMemoryProvider } from '../support/mock-memory-provider.js';

const logger = pino({ level: 'silent' });
const mission = {
  id: '00000000-0000-4000-8000-000000001701',
  objective: 'Research and verify official information about X',
};
const now = new Date('2026-08-23T12:00:00.000Z');

function agent(id: string, amount: string, status: LocalTestAgent['status']): LocalTestAgent {
  return {
    id,
    name: `[LOCAL TEST] ${id}`,
    source: 'LOCAL_TEST',
    provider: 'local-test',
    capabilities: ['research', 'fact-verification'],
    status,
    cost: { model: 'FIXED', amount, currency: 'USD' },
    metadata: { phase: 17 },
  };
}

function registry(statusA: LocalTestAgent['status'] = 'AVAILABLE'): InMemoryAgentRegistry {
  const result = new InMemoryAgentRegistry();
  result.register(agent('agent-a', '0.10', statusA));
  result.register(agent('agent-b', '0.50', 'AVAILABLE'));
  return result;
}

function recalled(overrides: Partial<MemoryRecord>): RecalledMemory {
  const record: MemoryRecord = {
    schemaVersion: 1,
    id: 'irrelevant-memory',
    category: 'experience',
    timestamp: '2020-01-01T00:00:00.000Z',
    missionId: 'old-unrelated-mission',
    mission: 'Summarize an unrelated cooking article',
    capability: 'summarization',
    agentId: 'agent-b',
    success: true,
    verification: { status: 'PASS', summary: 'Old unrelated success' },
    ...overrides,
  };
  return { record, sibylRecordId: `sibyl-${record.id}`, sibylTier: 'entity' };
}

describe('Phase 17 hostile memory and agent selection', () => {
  it('cannot make an experience-driven choice when required memory is missing', async () => {
    const decision = await new DecisionEngine(
      registry(),
      new MemoryService(new DisabledMemoryProvider(), logger),
      { now: () => now },
    ).decide(mission, ['research', 'fact-verification']);

    expect(decision).toMatchObject({
      selectedAgent: { id: 'agent-a' },
      historicalExperience: 'unavailable',
      confidence: 0.1,
      memoryReferences: [],
    });
    expect(decision).not.toHaveProperty('decisionMemoryId');
  });

  it('does not let stale and unrelated memory create a false preference', async () => {
    const provider = new MockMemoryProvider();
    provider.searchResult = [
      recalled({}),
      recalled({
        id: 'wrong-agent',
        agentId: 'unknown-agent',
        capability: 'fact-verification',
        mission: mission.objective,
        timestamp: '2026-08-22T12:00:00.000Z',
      }),
    ];
    const decision = await new DecisionEngine(registry(), new MemoryService(provider, logger), {
      now: () => now,
    }).decide(mission, ['research', 'fact-verification']);

    expect(decision.selectedAgent.id).toBe('agent-a');
    expect(decision.memoryReferences).toEqual([]);
    expect(decision.evidence.every(({ metrics }) => metrics.observationCount === 0)).toBe(true);
  });

  it('never selects an unavailable agent even when it is cheaper', async () => {
    const decision = await new DecisionEngine(
      registry('UNAVAILABLE'),
      new MemoryService(new MockMemoryProvider(), logger),
      { now: () => now },
    ).decide(mission, ['research', 'fact-verification']);
    expect(decision.selectedAgent.id).toBe('agent-b');
    expect(decision.evidence.map(({ agentId }) => agentId)).toEqual(['agent-b']);
  });

  it('fails explicitly when every capable agent is unavailable', async () => {
    const unavailable = new InMemoryAgentRegistry();
    unavailable.register(agent('agent-a', '0.10', 'UNAVAILABLE'));
    await expect(
      new DecisionEngine(unavailable, new MemoryService(new MockMemoryProvider(), logger)).decide(
        mission,
        ['research'],
      ),
    ).rejects.toMatchObject({ code: 'NO_ELIGIBLE_AGENTS', statusCode: 422 });
  });
});
