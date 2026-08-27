import type { ExternalVirtualsAgent } from '../../agents/agent.js';
import type { JsonObject } from '../../missions/mission.js';
import type { OfferingCompatibility } from './offering-compatibility.js';

export interface VirtualsAgentDiscoveryRequest {
  readonly capabilities: readonly string[];
  readonly missionObjective: string;
  readonly limit?: number;
}

export interface VirtualsAgentCandidate {
  readonly agent: ExternalVirtualsAgent;
  readonly chainId: number;
  readonly providerAddress: string;
  readonly offeringName: string;
  readonly offeringRequirements: Record<string, unknown> | string;
  readonly compatibility?: OfferingCompatibility;
}

export type VirtualsJobState =
  'OPEN' | 'BUDGET_PROPOSED' | 'FUNDED' | 'SUBMITTED' | 'COMPLETED' | 'REJECTED' | 'EXPIRED';

export interface VirtualsJobSnapshot {
  readonly jobId: string;
  readonly chainId: number;
  readonly state: VirtualsJobState;
  readonly providerAddress: string;
  readonly deliverable?: string;
  readonly budget?: { readonly amount: string; readonly currency: string };
}

export interface CreateVirtualsJobRequest {
  readonly chainId: number;
  readonly providerAddress: string;
  readonly offeringName: string;
  readonly requirements: JsonObject;
}

/** Application-owned boundary implemented by the official ACP Node v2 adapter. */
export interface VirtualsAgentSource {
  readonly provider: 'virtuals';
  discoverCandidates(
    request: VirtualsAgentDiscoveryRequest,
  ): Promise<readonly VirtualsAgentCandidate[]>;
  createJob(request: CreateVirtualsJobRequest): Promise<string>;
  getJob(chainId: number, jobId: string): Promise<VirtualsJobSnapshot>;
  fundJob(chainId: number, jobId: string): Promise<void>;
  completeJob(chainId: number, jobId: string, reason: string): Promise<void>;
  rejectJob(chainId: number, jobId: string, reason: string): Promise<void>;
  close(): Promise<void>;
}
