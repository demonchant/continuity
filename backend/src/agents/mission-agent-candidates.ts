import type { Mission } from '../missions/mission.js';
import type { Agent } from './agent.js';
import type { AgentRegistry } from './agent-registry.js';

export interface MissionAgentCandidates {
  readonly requiredCapabilities: readonly string[];
  readonly candidates: readonly Agent[];
}

const capabilityRules: readonly { readonly capability: string; readonly pattern: RegExp }[] = [
  { capability: 'research', pattern: /\b(research|investigate|find information|sources?)\b/i },
  {
    capability: 'fact-verification',
    pattern: /\b(verify|verification|fact[- ]?check|validate claims?|check accuracy)\b/i,
  },
  { capability: 'summarization', pattern: /\b(summarize|summary|condense)\b/i },
  { capability: 'analysis', pattern: /\b(analyze|analysis|compare|evaluate)\b/i },
];

export function inferMissionCapabilities(objective: string): readonly string[] {
  return capabilityRules
    .filter(({ pattern }) => pattern.test(objective))
    .map(({ capability }) => capability);
}

export class MissionAgentCandidateService {
  constructor(private readonly registry: AgentRegistry) {}

  identify(
    mission: Pick<Mission, 'objective'>,
    requiredCapabilities: readonly string[] = inferMissionCapabilities(mission.objective),
  ): MissionAgentCandidates {
    if (requiredCapabilities.length === 0) {
      return { requiredCapabilities: [], candidates: [] };
    }

    const matches = requiredCapabilities.map((capability) =>
      this.registry.filterByCapability(capability),
    );
    const candidates = matches[0]?.filter(
      (agent) =>
        agent.status === 'AVAILABLE' &&
        matches.every((agents) => agents.some(({ id }) => id === agent.id)),
    );

    return {
      requiredCapabilities: [...requiredCapabilities],
      candidates: candidates ?? [],
    };
  }
}
