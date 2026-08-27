import { describe, expect, it } from 'vitest';
import { InMemoryAgentRegistry } from '../../src/agents/agent-registry.js';
import { localTestAgents, registerLocalTestAgents } from '../../src/agents/local-test-agents.js';
import {
  inferMissionCapabilities,
  MissionAgentCandidateService,
} from '../../src/agents/mission-agent-candidates.js';

describe('mission agent candidates', () => {
  it('infers research and verification requirements from a mission objective', () => {
    expect(inferMissionCapabilities('Research and verify information about X')).toEqual([
      'research',
      'fact-verification',
    ]);
  });

  it('identifies only available agents that satisfy every mission capability', () => {
    const registry = new InMemoryAgentRegistry();
    registerLocalTestAgents(registry);
    registry.register({
      id: 'local-test-busy-research-verifier',
      name: '[LOCAL TEST] Busy Research Verifier',
      source: 'LOCAL_TEST',
      provider: 'local-test',
      capabilities: ['research', 'fact-verification'],
      status: 'BUSY',
      cost: { model: 'FREE', amount: '0', currency: 'USD' },
      metadata: { synthetic: true },
    });
    const service = new MissionAgentCandidateService(registry);

    const result = service.identify({
      objective: 'Research and verify information about X',
    });

    expect(result.requiredCapabilities).toEqual(['research', 'fact-verification']);
    expect(result.candidates.map(({ id }) => id)).toEqual(['local-test-research-verifier']);
  });

  it('does not guess candidates when the objective has no recognized capability', () => {
    const registry = new InMemoryAgentRegistry();
    registerLocalTestAgents(registry);

    expect(
      new MissionAgentCandidateService(registry).identify({ objective: 'Do something novel' }),
    ).toEqual({ requiredCapabilities: [], candidates: [] });
  });

  it('labels every development candidate as synthetic local/test data', () => {
    expect(localTestAgents).not.toHaveLength(0);
    for (const agent of localTestAgents) {
      expect(agent).toMatchObject({
        source: 'LOCAL_TEST',
        provider: 'local-test',
        metadata: { synthetic: true, environment: 'local-development' },
      });
      expect(agent.name).toContain('[LOCAL TEST]');
    }
  });
});
