import { describe, expect, it } from 'vitest';
import type { Agent, ExternalVirtualsAgent, LocalTestAgent } from '../../src/agents/agent.js';
import { InMemoryAgentRegistry } from '../../src/agents/agent-registry.js';

const localAgent: LocalTestAgent = {
  id: 'local-agent-1',
  name: '[LOCAL TEST] Researcher',
  source: 'LOCAL_TEST',
  provider: 'local-test',
  capabilities: ['Research', 'fact_verification', 'research'],
  status: 'AVAILABLE',
  cost: { model: 'FREE', amount: '0', currency: 'USD' },
  metadata: { synthetic: true },
};

const virtualsAgent: ExternalVirtualsAgent = {
  id: 'virtuals-agent-1',
  externalId: 'future-provider-id-1',
  name: 'External Candidate',
  source: 'EXTERNAL_VIRTUALS',
  provider: 'virtuals',
  capabilities: ['research'],
  status: 'UNKNOWN',
  cost: { model: 'UNKNOWN' },
  metadata: {},
};

function thrownBy(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('Expected action to throw');
}

describe('InMemoryAgentRegistry', () => {
  it('registers, lists, and retrieves normalized agents', () => {
    const registry = new InMemoryAgentRegistry();
    registry.register(localAgent);

    expect(registry.get(localAgent.id)).toMatchObject({
      id: localAgent.id,
      capabilities: ['fact-verification', 'research'],
    });
    expect(registry.list()).toHaveLength(1);
  });

  it('filters by normalized capability without conflating provider source', () => {
    const registry = new InMemoryAgentRegistry();
    registry.register(localAgent);
    registry.register(virtualsAgent);

    const results = registry.filterByCapability('RESEARCH');

    expect(results.map(({ id }) => id)).toEqual(['local-agent-1', 'virtuals-agent-1']);
    expect(results.map(({ source }) => source)).toEqual(['LOCAL_TEST', 'EXTERNAL_VIRTUALS']);
  });

  it('rejects duplicate IDs', () => {
    const registry = new InMemoryAgentRegistry();
    registry.register(localAgent);

    expect(thrownBy(() => registry.register(localAgent))).toMatchObject({
      code: 'DUPLICATE_AGENT',
    });
  });

  it('rejects invalid runtime source/provider combinations', () => {
    const registry = new InMemoryAgentRegistry();
    const mislabeled = {
      ...localAgent,
      provider: 'virtuals',
    } as unknown as Agent;

    expect(thrownBy(() => registry.register(mislabeled))).toMatchObject({
      code: 'INVALID_AGENT',
    });
  });
});
