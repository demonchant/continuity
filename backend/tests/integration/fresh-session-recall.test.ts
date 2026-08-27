import pino from 'pino';
import { describe, expect, it } from 'vitest';
import {
  FreshSessionRecallDemo,
  freshSessionAgents,
} from '../../src/demo/fresh-session-recall-demo.js';
import type { ProviderRecallQuery } from '../../src/memory/memory-provider.js';
import type { RecalledMemory } from '../../src/memory/memory-record.js';
import { MemoryService } from '../../src/memory/memory-service.js';
import { MockMemoryProvider } from '../support/mock-memory-provider.js';

class PersistentSibylTestProvider extends MockMemoryProvider {
  override search(query: ProviderRecallQuery): Promise<readonly RecalledMemory[]> {
    this.searches.push(query);
    return Promise.resolve(
      this.records
        .filter(({ category }) => !query.categories || query.categories.includes(category))
        .slice(-query.limit)
        .map((record) => ({
          record,
          sibylRecordId: `sibyl-record-${record.id}`,
          sibylTier: 'entity',
        })),
    );
  }
}

describe('Phase 16 fresh-session recall', () => {
  it('recalls a verifier-generated Session A failure in a newly constructed Session B', async () => {
    const logger = pino({ level: 'silent' });
    const provider = new PersistentSibylTestProvider();
    const runId = 'fresh-session-test';
    const [agentA, agentB] = freshSessionAgents(runId);

    // Session A begins with an empty durable provider. No failure fixture is inserted.
    expect(provider.records).toHaveLength(0);
    const sessionA = await new FreshSessionRecallDemo(
      runId,
      new MemoryService(provider, logger),
      logger,
    ).sessionA();
    expect(sessionA.decision.selectedAgent.id).toBe(agentA.id);
    expect(sessionA.verification.passed).toBe(false);
    const failuresAfterSessionA = provider.records.filter(
      ({ category, agentId }) => category === 'failure' && agentId === agentA.id,
    );
    expect(failuresAfterSessionA).toHaveLength(1);

    // Session B is a fresh application graph: new demo, memory service, mission,
    // registry, decision engine, and verifier. Only the Sibyl provider persists.
    const sessionB = await new FreshSessionRecallDemo(
      runId,
      new MemoryService(provider, logger),
      logger,
    ).sessionB();
    expect(sessionB.decision).toMatchObject({
      selectedAgent: { id: agentB.id },
      historicalExperience: 'available',
    });
    expect(sessionB.decision.memoryReferences).toHaveLength(1);
    expect(sessionB.decision.reason).toContain(
      '[LOCAL TEST] Agent A is not recommended because it failed a comparable mission previously',
    );
    expect(sessionB.verification).toMatchObject({ passed: true, failedRequirements: [] });
    expect(
      provider.records.filter(
        ({ category, agentId }) => category === 'experience' && agentId === agentB.id,
      ),
    ).toHaveLength(1);
  });
});
