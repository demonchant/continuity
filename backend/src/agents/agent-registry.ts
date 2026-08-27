import type { Agent } from './agent.js';
import { normalizeAgent, normalizeCapability } from './agent.js';

export interface AgentRegistry {
  register(agent: Agent): void;
  list(): readonly Agent[];
  get(id: string): Agent | null;
  filterByCapability(capability: string): readonly Agent[];
}

export class AgentRegistryError extends Error {
  readonly code: 'DUPLICATE_AGENT' | 'INVALID_AGENT';

  constructor(code: 'DUPLICATE_AGENT' | 'INVALID_AGENT', message: string) {
    super(message);
    this.name = 'AgentRegistryError';
    this.code = code;
  }
}

/** Process-local catalog for configured candidates; it stores no experience. */
export class InMemoryAgentRegistry implements AgentRegistry {
  private readonly agents = new Map<string, Agent>();

  register(agent: Agent): void {
    this.validate(agent);
    if (this.agents.has(agent.id)) {
      throw new AgentRegistryError('DUPLICATE_AGENT', `Agent is already registered: ${agent.id}`);
    }
    this.agents.set(agent.id, normalizeAgent(agent));
  }

  list(): readonly Agent[] {
    return [...this.agents.values()];
  }

  get(id: string): Agent | null {
    return this.agents.get(id) ?? null;
  }

  filterByCapability(capability: string): readonly Agent[] {
    const normalized = normalizeCapability(capability);
    if (!normalized) return [];
    return [...this.agents.values()].filter((agent) => agent.capabilities.includes(normalized));
  }

  private validate(agent: Agent): void {
    if (!agent.id.trim() || !agent.name.trim() || agent.capabilities.length === 0) {
      throw new AgentRegistryError(
        'INVALID_AGENT',
        'Agent id, name, and at least one capability are required',
      );
    }
    const validDiscriminator =
      (agent.source === 'LOCAL_TEST' && agent.provider === 'local-test') ||
      (agent.source === 'EXTERNAL_VIRTUALS' && agent.provider === 'virtuals');
    if (!validDiscriminator) {
      throw new AgentRegistryError('INVALID_AGENT', 'Agent source and provider do not match');
    }
  }
}
