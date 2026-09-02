import {
  AcpAgent,
  AcpJobStatus,
  PrivyAlchemyEvmProviderAdapter,
  getEvmChainByChainId,
  type JobSession,
  type OffChainJob,
} from '@virtuals-protocol/acp-node-v2';
import type {
  CreateVirtualsJobRequest,
  VirtualsAgentCandidate,
  VirtualsAgentDiscoveryRequest,
  VirtualsAgentSource,
  VirtualsJobSnapshot,
  VirtualsJobState,
} from './virtuals-agent-source.js';
import { VirtualsProtocolError } from './virtuals-errors.js';
import { type VirtualsDiscoveryClient } from './virtuals-discovery-client.js';

export interface VirtualsAcpConfiguration {
  readonly walletAddress: `0x${string}`;
  readonly walletId: string;
  readonly signerPrivateKey: string;
  readonly chainId: number;
  readonly builderCode?: string;
}

export interface VirtualsAcpAgentClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  getAddress(): Promise<string>;
  createJobByOfferingName(
    chainId: number,
    offeringName: string,
    providerAddress: string,
    requirementData: Record<string, unknown> | string,
    options?: { readonly evaluatorAddress?: string },
  ): Promise<bigint>;
  getSession(chainId: number, jobId: string): JobSession | undefined;
  getApi(): { getJob(chainId: number, jobId: string): Promise<OffChainJob | null> };
}

function stateFromSession(status: JobSession['status']): VirtualsJobState {
  switch (status) {
    case 'open':
      return 'OPEN';
    case 'budget_set':
      return 'BUDGET_PROPOSED';
    case 'funded':
      return 'FUNDED';
    case 'submitted':
      return 'SUBMITTED';
    case 'completed':
      return 'COMPLETED';
    case 'rejected':
      return 'REJECTED';
    case 'expired':
      return 'EXPIRED';
  }
}

function stateFromApi(status: OffChainJob['jobStatus']): VirtualsJobState {
  switch (status) {
    case AcpJobStatus.OPEN:
      return 'OPEN';
    case AcpJobStatus.FUNDED:
      return 'FUNDED';
    case AcpJobStatus.SUBMITTED:
      return 'SUBMITTED';
    case AcpJobStatus.COMPLETED:
      return 'COMPLETED';
    case AcpJobStatus.REJECTED:
      return 'REJECTED';
    case AcpJobStatus.EXPIRED:
      return 'EXPIRED';
  }
  throw new VirtualsProtocolError(
    'VIRTUALS_PROVIDER_ERROR',
    `Virtuals ACP returned an unsupported job state: ${String(status)}`,
    false,
  );
}

export class VirtualsAcpAdapter implements VirtualsAgentSource {
  readonly provider = 'virtuals' as const;
  private startPromise?: Promise<void>;

  constructor(
    private readonly agent: VirtualsAcpAgentClient,
    _chainId: number,
    private readonly discovery: VirtualsDiscoveryClient,
  ) {}

  static async create(
    configuration: VirtualsAcpConfiguration,
    discovery: VirtualsDiscoveryClient,
  ): Promise<VirtualsAcpAdapter> {
    const chain = getEvmChainByChainId(configuration.chainId);
    if (!chain) {
      throw new VirtualsProtocolError(
        'VIRTUALS_CONFIGURATION_ERROR',
        `Virtuals ACP does not support configured EVM chain ${configuration.chainId}`,
        false,
      );
    }
    const provider = await PrivyAlchemyEvmProviderAdapter.create({
      walletAddress: configuration.walletAddress,
      walletId: configuration.walletId,
      signerPrivateKey: configuration.signerPrivateKey,
      chains: [chain],
      ...(configuration.builderCode ? { builderCode: configuration.builderCode } : {}),
    });
    return new VirtualsAcpAdapter(
      await AcpAgent.create({ evmProvider: provider }),
      configuration.chainId,
      discovery,
    );
  }

  async discoverCandidates(
    request: VirtualsAgentDiscoveryRequest,
  ): Promise<readonly VirtualsAgentCandidate[]> {
    try {
      return await this.discovery.discoverCandidates(request);
    } catch (error) {
      throw new VirtualsProtocolError(
        'VIRTUALS_DISCOVERY_FAILED',
        'Virtuals ACP agent discovery failed',
        true,
        { cause: error },
      );
    }
  }

  async createJob(request: CreateVirtualsJobRequest): Promise<string> {
    await this.start();
    try {
      const evaluatorAddress = await this.agent.getAddress();
      const jobId = await this.agent.createJobByOfferingName(
        request.chainId,
        request.offeringName,
        request.providerAddress,
        request.requirements,
        { evaluatorAddress },
      );
      return jobId.toString();
    } catch (error) {
      throw new VirtualsProtocolError(
        'VIRTUALS_JOB_CREATION_FAILED',
        'Virtuals ACP job creation failed',
        false,
        { cause: error },
      );
    }
  }

  async getJob(chainId: number, jobId: string): Promise<VirtualsJobSnapshot> {
    await this.start();
    try {
      const session = this.agent.getSession(chainId, jobId);
      if (session) {
        const job = await session.fetchJob();
        return {
          jobId,
          chainId,
          state: stateFromSession(session.status),
          providerAddress: job.providerAddress,
          ...(job.deliverable ? { deliverable: job.deliverable } : {}),
          ...(job.budget
            ? { budget: { amount: job.budget.amount.toString(), currency: job.budget.symbol } }
            : {}),
        };
      }
      const job = await this.agent.getApi().getJob(chainId, jobId);
      if (!job) {
        throw new VirtualsProtocolError(
          'VIRTUALS_JOB_NOT_FOUND',
          `Virtuals ACP job was not found: ${jobId}`,
          true,
        );
      }
      return {
        jobId,
        chainId,
        state: stateFromApi(job.jobStatus),
        providerAddress: job.providerAddress,
        ...(job.deliverable ? { deliverable: job.deliverable } : {}),
        ...(job.budget ? { budget: { amount: job.budget, currency: 'USDC' } } : {}),
      };
    } catch (error) {
      if (error instanceof VirtualsProtocolError) throw error;
      throw new VirtualsProtocolError(
        'VIRTUALS_PROVIDER_ERROR',
        'Virtuals ACP job state retrieval failed',
        true,
        { cause: error },
      );
    }
  }

  fundJob(chainId: number, jobId: string): Promise<void> {
    return this.sessionAction(chainId, jobId, 'VIRTUALS_FUNDING_FAILED', (session) =>
      session.fund(),
    );
  }

  completeJob(chainId: number, jobId: string, reason: string): Promise<void> {
    return this.sessionAction(chainId, jobId, 'VIRTUALS_SETTLEMENT_FAILED', (session) =>
      session.complete(reason),
    );
  }

  rejectJob(chainId: number, jobId: string, reason: string): Promise<void> {
    return this.sessionAction(chainId, jobId, 'VIRTUALS_SETTLEMENT_FAILED', (session) =>
      session.reject(reason),
    );
  }

  async close(): Promise<void> {
    if (this.startPromise) await this.agent.stop();
  }

  private start(): Promise<void> {
    this.startPromise ??= this.agent.start();
    return this.startPromise;
  }

  private async sessionAction(
    chainId: number,
    jobId: string,
    code: 'VIRTUALS_FUNDING_FAILED' | 'VIRTUALS_SETTLEMENT_FAILED',
    action: (session: JobSession) => Promise<void>,
  ): Promise<void> {
    await this.start();
    const session = this.agent.getSession(chainId, jobId);
    if (!session) {
      throw new VirtualsProtocolError(
        'VIRTUALS_JOB_NOT_FOUND',
        `Virtuals ACP session was not found: ${jobId}`,
        true,
      );
    }
    try {
      await action(session);
    } catch (error) {
      throw new VirtualsProtocolError(code, 'Virtuals ACP job action failed', true, {
        cause: error,
      });
    }
  }
}
