import type { JsonObject } from '../missions/mission.js';

export const agentStatuses = ['AVAILABLE', 'BUSY', 'UNAVAILABLE', 'UNKNOWN'] as const;
export type AgentStatus = (typeof agentStatuses)[number];

export const agentCostModels = ['FREE', 'FIXED', 'PER_TASK', 'PER_HOUR', 'UNKNOWN'] as const;
export type AgentCostModel = (typeof agentCostModels)[number];

export interface AgentCost {
  readonly model: AgentCostModel;
  /** Decimal string; omitted when the provider has not supplied a price. */
  readonly amount?: string;
  readonly currency?: string;
  readonly description?: string;
}

interface AgentBase {
  readonly id: string;
  readonly name: string;
  readonly capabilities: readonly string[];
  readonly status: AgentStatus;
  readonly cost: AgentCost;
  readonly metadata: JsonObject;
}

/** Development-only agent. It is never evidence of a Virtuals integration. */
export interface LocalTestAgent extends AgentBase {
  readonly source: 'LOCAL_TEST';
  readonly provider: 'local-test';
}

/** Normalized candidate returned by the active Virtuals discovery boundary. */
export interface ExternalVirtualsAgent extends AgentBase {
  readonly source: 'EXTERNAL_VIRTUALS';
  readonly provider: 'virtuals';
  readonly externalId: string;
}

export type Agent = LocalTestAgent | ExternalVirtualsAgent;

export function normalizeCapability(capability: string): string {
  return capability
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

export function normalizeAgent(agent: Agent): Agent {
  const capabilities = [
    ...new Set(agent.capabilities.map(normalizeCapability).filter(Boolean)),
  ].sort();
  return Object.freeze({ ...agent, capabilities: Object.freeze(capabilities) });
}
