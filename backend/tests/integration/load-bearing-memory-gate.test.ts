import pino from 'pino';
import { describe, expect, it } from 'vitest';
import type { LocalTestAgent } from '../../src/agents/agent.js';
import { InMemoryAgentRegistry } from '../../src/agents/agent-registry.js';
import { loadConfig } from '../../src/config/index.js';
import { createConfiguredMemoryProvider } from '../../src/config/memory-provider.js';
import { DecisionEngine } from '../../src/decisions/decision-engine.js';
import { DisabledMemoryProvider } from '../../src/memory/memory-provider.js';
import type { ProviderRecallQuery } from '../../src/memory/memory-provider.js';
import type { RecalledMemory } from '../../src/memory/memory-record.js';
import { MemoryService } from '../../src/memory/memory-service.js';
import type { JsonObject } from '../../src/missions/mission.js';
import { MissionService } from '../../src/missions/mission-service.js';
import { VerificationService } from '../../src/verification/verification-service.js';
import { InMemoryMissionRepository } from '../support/in-memory-mission-repository.js';
import { MockMemoryProvider } from '../support/mock-memory-provider.js';

const logger = pino({ level: 'silent' });
const now = new Date('2026-08-22T12:00:00.000Z');
const capabilities = ['research', 'fact-verification'] as const;
const objective = 'Research and verify information about X';
const constraints: JsonObject = {
  output: { format: 'object', requiredFields: ['summary'] },
  requiredSources: 1,
  requireEvidence: true,
};

const agentA: LocalTestAgent = {
  id: 'agent-a',
  name: '[LOCAL TEST] Agent A',
  source: 'LOCAL_TEST',
  provider: 'local-test',
  capabilities,
  status: 'AVAILABLE',
  cost: { model: 'FIXED', amount: '0.10', currency: 'USD' },
  metadata: { syntheticExecution: true },
};
const agentB: LocalTestAgent = {
  id: 'agent-b',
  name: '[LOCAL TEST] Agent B',
  source: 'LOCAL_TEST',
  provider: 'local-test',
  capabilities,
  status: 'AVAILABLE',
  cost: { model: 'FIXED', amount: '0.50', currency: 'USD' },
  metadata: { syntheticExecution: true },
};

class SearchableSibylTestProvider extends MockMemoryProvider {
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

function registry(): InMemoryAgentRegistry {
  const result = new InMemoryAgentRegistry();
  result.register(agentA);
  result.register(agentB);
  return result;
}

describe('HARD GATE: Sibyl is load-bearing', () => {
  it('loses experience-driven selection when the configured Sibyl layer is removed', async () => {
    const sibyl = new SearchableSibylTestProvider();
    const memory = new MemoryService(sibyl, logger, { now: () => now });
    const missions = new MissionService(new InMemoryMissionRepository());
    const firstMission = await missions.create({ objective, constraints, budget: '1.00' });
    const comparableMission = await missions.create({ objective, constraints, budget: '1.00' });
    const deletionMission = await missions.create({ objective, constraints, budget: '1.00' });

    // Mission one has no history, so cheaper Agent A wins through real decision logic.
    const initialDecision = await new DecisionEngine(registry(), memory, { now: () => now }).decide(
      firstMission,
      capabilities,
    );
    expect(initialDecision).toMatchObject({
      selectedAgent: { id: 'agent-a' },
      historicalExperience: 'available',
      memoryReferences: [],
    });

    // This is not an injected failure record. The actual verifier rejects an
    // Agent A result that omits the required summary, source, and evidence.
    const verification = await new VerificationService(memory, logger).verify({
      mission: firstMission,
      agent: initialDecision.selectedAgent,
      capability: capabilities.join(','),
      result: {
        output: { details: 'An unsupported answer without the required proof.' },
        claimedSuccess: true,
        providerReference: 'verification-heavy-attempt-a',
      },
    });
    expect(verification).toMatchObject({
      passed: false,
      failedRequirements: expect.arrayContaining([
        'requiredField:summary',
        'requiredSources',
        'evidencePresence',
      ]),
    });
    const generatedFailures = sibyl.records.filter(
      ({ category, agentId }) => category === 'failure' && agentId === 'agent-a',
    );
    expect(generatedFailures).toHaveLength(2);
    expect(generatedFailures.map(({ capability }) => capability).sort()).toEqual([
      'fact-verification',
      'research',
    ]);
    expect(generatedFailures.every(({ failureReason }) => failureReason?.includes('missing'))).toBe(
      true,
    );

    // A fresh comparable mission recalls that verifier-generated failure and
    // pays the cost premium for Agent B.
    const withSibyl = await new DecisionEngine(registry(), memory, { now: () => now }).decide(
      comparableMission,
      capabilities,
    );
    expect(withSibyl.selectedAgent.id).toBe('agent-b');
    expect(withSibyl.historicalExperience).toBe('available');
    expect(withSibyl.reason).toContain('Sibyl evidence penalized');
    expect(withSibyl.memoryReferences).toHaveLength(2);
    expect(withSibyl.evidence.find(({ agentId }) => agentId === 'agent-a')).toMatchObject({
      metrics: {
        observationCount: 2,
        successRate: 0,
        verificationSuccessRate: 0,
      },
    });

    // Use the same provider composition path as the server's controlled
    // MEMORY_ENABLED=false test mode. It is unavailable, never a local store.
    const disabledConfig = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:password@localhost:5432/continuity_test',
      MEMORY_ENABLED: 'false',
    });
    const removedProvider = createConfiguredMemoryProvider(disabledConfig.memory);
    expect(removedProvider).toBeInstanceOf(DisabledMemoryProvider);
    const withoutMemory = await new DecisionEngine(
      registry(),
      new MemoryService(removedProvider, logger),
      { now: () => now },
    ).decide(deletionMission, capabilities);

    expect(withoutMemory).toMatchObject({
      selectedAgent: { id: 'agent-a' },
      historicalExperience: 'unavailable',
      confidence: 0.1,
      memoryReferences: [],
    });
    expect(withoutMemory.reason).toContain('Sibyl historical experience was unavailable');
    expect(withoutMemory.evidence.every(({ metrics }) => metrics.observationCount === 0)).toBe(
      true,
    );
    expect(withoutMemory).not.toHaveProperty('decisionMemoryId');

    // The claim fails without Sibyl: the exact equivalent candidate set returns
    // to the cheaper Agent A because historical failure cannot be retrieved.
    expect(withSibyl.selectedAgent.id).not.toBe(withoutMemory.selectedAgent.id);
  });
});
