import type { LocalTestAgent } from './agent.js';
import type { AgentRegistry } from './agent-registry.js';

/**
 * Synthetic candidates for local development only. These are not Virtuals
 * agents, do not use external provider IDs, and must never be shown as live.
 */
export const localTestAgents: readonly LocalTestAgent[] = Object.freeze([
  {
    id: 'local-test-research-scout',
    name: '[LOCAL TEST] Research Scout',
    source: 'LOCAL_TEST',
    provider: 'local-test',
    capabilities: ['research', 'source-discovery'],
    status: 'AVAILABLE',
    cost: { model: 'FREE', amount: '0', currency: 'USD' },
    metadata: {
      environment: 'local-development',
      synthetic: true,
      description: 'Synthetic research candidate used by automated and local tests',
    },
  },
  {
    id: 'local-test-claim-verifier',
    name: '[LOCAL TEST] Claim Verifier',
    source: 'LOCAL_TEST',
    provider: 'local-test',
    capabilities: ['fact-verification', 'claim-validation'],
    status: 'AVAILABLE',
    cost: { model: 'FREE', amount: '0', currency: 'USD' },
    metadata: {
      environment: 'local-development',
      synthetic: true,
      description: 'Synthetic verification candidate used by automated and local tests',
    },
  },
  {
    id: 'local-test-research-verifier',
    name: '[LOCAL TEST] Research and Verification Agent',
    source: 'LOCAL_TEST',
    provider: 'local-test',
    capabilities: ['research', 'fact-verification', 'source-discovery'],
    status: 'AVAILABLE',
    cost: { model: 'FIXED', amount: '0.10', currency: 'USD' },
    metadata: {
      environment: 'local-development',
      synthetic: true,
      description: 'Synthetic multi-capability candidate used by automated and local tests',
    },
  },
]);

export function registerLocalTestAgents(registry: AgentRegistry): void {
  for (const agent of localTestAgents) registry.register(agent);
}
