/* eslint-disable @typescript-eslint/unbound-method */
import type { JobSession } from '@virtuals-protocol/acp-node-v2';
import { describe, expect, it, vi } from 'vitest';
import {
  VirtualsAcpAdapter,
  type VirtualsAcpAgentClient,
} from '../../src/integrations/virtuals/virtuals-acp-adapter.js';
import type { VirtualsProtocolError } from '../../src/integrations/virtuals/virtuals-errors.js';
import type { VirtualsDiscoveryClient } from '../../src/integrations/virtuals/virtuals-discovery-client.js';

function client(overrides: Partial<VirtualsAcpAgentClient> = {}): VirtualsAcpAgentClient {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getAddress: vi.fn().mockResolvedValue('0x2222222222222222222222222222222222222222'),
    createJobByOfferingName: vi.fn().mockResolvedValue(99n),
    getSession: vi.fn().mockReturnValue(undefined),
    getApi: vi.fn().mockReturnValue({ getJob: vi.fn().mockResolvedValue(null) }),
    ...overrides,
  };
}

function discovery(overrides: Partial<VirtualsDiscoveryClient> = {}): VirtualsDiscoveryClient {
  return {
    discoverCandidates: vi.fn().mockResolvedValue([
      {
        agent: {
          id: 'virtuals:8453:0x1111111111111111111111111111111111111111',
          externalId: '0x1111111111111111111111111111111111111111',
          name: 'Real ACP Researcher',
          source: 'EXTERNAL_VIRTUALS',
          provider: 'virtuals',
          capabilities: ['fact-verification'],
          status: 'AVAILABLE',
          cost: { model: 'FIXED', amount: '0.25', currency: 'USDC' },
          metadata: { acpAgentId: 'agent-42' },
        },
        chainId: 8453,
        providerAddress: '0x1111111111111111111111111111111111111111',
        offeringId: 'offering-1',
        offeringName: 'research',
        offeringRequirements: {},
      },
    ]),
    ...overrides,
  };
}

describe('VirtualsAcpAdapter', () => {
  it('delegates discovery to the read-only OAuth boundary without starting the ACP SDK', async () => {
    const sdk = client();
    const oauth = discovery();
    const adapter = new VirtualsAcpAdapter(sdk, 8453, oauth);
    const candidates = await adapter.discoverCandidates({
      missionObjective: 'Research X',
      capabilities: ['fact verification'],
      limit: 3,
    });

    expect(oauth.discoverCandidates).toHaveBeenCalledWith({
      missionObjective: 'Research X',
      capabilities: ['fact verification'],
      limit: 3,
    });
    expect(sdk.start).not.toHaveBeenCalled();
    expect(sdk.createJobByOfferingName).not.toHaveBeenCalled();
    expect(candidates[0]).toMatchObject({
      agent: {
        source: 'EXTERNAL_VIRTUALS',
        provider: 'virtuals',
        capabilities: ['fact-verification'],
        cost: { amount: '0.25', currency: 'USDC' },
      },
      chainId: 8453,
      offeringName: 'research',
    });
  });

  it('passes through an empty discovery result', async () => {
    const adapter = new VirtualsAcpAdapter(
      client(),
      8453,
      discovery({ discoverCandidates: vi.fn().mockResolvedValue([]) }),
    );
    await expect(
      adapter.discoverCandidates({
        missionObjective: 'Research X',
        capabilities: ['research'],
      }),
    ).resolves.toEqual([]);
  });

  it('creates a real ACP job with Continuity as evaluator', async () => {
    const sdk = client();
    const adapter = new VirtualsAcpAdapter(sdk, 8453, discovery());
    await expect(
      adapter.createJob({
        chainId: 8453,
        providerAddress: '0x1',
        offeringName: 'research',
        requirements: { topic: 'X' },
      }),
    ).resolves.toBe('99');
    expect(sdk.createJobByOfferingName).toHaveBeenCalledWith(
      8453,
      'research',
      '0x1',
      { topic: 'X' },
      { evaluatorAddress: '0x2222222222222222222222222222222222222222' },
    );
  });

  it('maps job state and invokes official session actions', async () => {
    const session = {
      status: 'submitted',
      fetchJob: vi.fn().mockResolvedValue({
        providerAddress: '0x1',
        deliverable: '{"summary":"done"}',
        budget: { amount: 250000n, symbol: 'USDC' },
      }),
      fund: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn().mockResolvedValue(undefined),
      reject: vi.fn().mockResolvedValue(undefined),
    } as unknown as JobSession;
    const adapter = new VirtualsAcpAdapter(
      client({ getSession: vi.fn().mockReturnValue(session) }),
      8453,
      discovery(),
    );
    await expect(adapter.getJob(8453, '99')).resolves.toMatchObject({
      state: 'SUBMITTED',
      deliverable: '{"summary":"done"}',
    });
    await adapter.fundJob(8453, '99');
    await adapter.completeJob(8453, '99', 'verified');
    await adapter.rejectJob(8453, '99', 'invalid');
    expect(session.fund).toHaveBeenCalledOnce();
    expect(session.complete).toHaveBeenCalledWith('verified');
    expect(session.reject).toHaveBeenCalledWith('invalid');
  });

  it('returns a classified retriable discovery error without leaking provider details', async () => {
    const adapter = new VirtualsAcpAdapter(
      client(),
      8453,
      discovery({
        discoverCandidates: vi.fn().mockRejectedValue(new Error('secret upstream body')),
      }),
    );
    await expect(
      adapter.discoverCandidates({ missionObjective: 'Research X', capabilities: ['research'] }),
    ).rejects.toMatchObject({
      code: 'VIRTUALS_DISCOVERY_FAILED',
      retriable: true,
      message: 'Virtuals ACP agent discovery failed',
    } satisfies Partial<VirtualsProtocolError>);
  });
});
