/* eslint-disable @typescript-eslint/unbound-method */
import { AgentSort, OnlineStatus } from '@virtuals-protocol/acp-node-v2';
import type { AcpAgentDetail, JobSession } from '@virtuals-protocol/acp-node-v2';
import { describe, expect, it, vi } from 'vitest';
import {
  VirtualsAcpAdapter,
  type VirtualsAcpAgentClient,
} from '../../src/integrations/virtuals/virtuals-acp-adapter.js';
import type { VirtualsProtocolError } from '../../src/integrations/virtuals/virtuals-errors.js';

function detail(): AcpAgentDetail {
  return {
    id: 42,
    name: 'Real ACP Researcher',
    walletAddress: '0x1111111111111111111111111111111111111111',
    cluster: 'research',
    tag: 'facts',
    lastActiveAt: '2026-08-22T00:00:00Z',
    rating: 4.8,
    offerings: [
      {
        name: 'research',
        description: 'Research facts and perform fact verification',
        deliverable: 'JSON report',
        requirements: {},
        slaMinutes: 10,
        priceType: 'fixed',
        priceValue: 0.25,
        requiredFunds: 0.25,
        isHidden: false,
        isPrivate: false,
      },
    ],
  } as unknown as AcpAgentDetail;
}

function client(overrides: Partial<VirtualsAcpAgentClient> = {}): VirtualsAcpAgentClient {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getAddress: vi.fn().mockResolvedValue('0x2222222222222222222222222222222222222222'),
    browseAgents: vi.fn().mockResolvedValue([detail()]),
    createJobByOfferingName: vi.fn().mockResolvedValue(99n),
    getSession: vi.fn().mockReturnValue(undefined),
    getApi: vi.fn().mockReturnValue({ getJob: vi.fn().mockResolvedValue(null) }),
    ...overrides,
  };
}

describe('VirtualsAcpAdapter', () => {
  it('uses official ACP browsing and normalizes executable external candidates', async () => {
    const sdk = client();
    const adapter = new VirtualsAcpAdapter(sdk, 8453);
    const candidates = await adapter.discoverCandidates({
      missionObjective: 'Research X',
      capabilities: ['fact verification'],
      limit: 3,
    });

    expect(sdk.browseAgents).toHaveBeenCalledWith('Research X fact verification', {
      sortBy: [AgentSort.SUCCESSFUL_JOB_COUNT, AgentSort.SUCCESS_RATE],
      topK: 3,
      isOnline: OnlineStatus.ONLINE,
      showHidden: false,
      walletAddressToExclude: '0x2222222222222222222222222222222222222222',
    });
    expect(candidates[0]).toMatchObject({
      agent: {
        source: 'EXTERNAL_VIRTUALS',
        provider: 'virtuals',
        capabilities: ['fact-verification'],
        cost: { amount: '0.25', currency: 'USDC' },
      },
      chainId: 8453,
      offeringName: 'research',
      compatibility: {
        compatible: true,
        matchedCapabilities: ['fact-verification'],
      },
    });
  });

  it('rejects agents whose public offerings do not establish the requested capability', async () => {
    const incompatible = detail();
    incompatible.offerings[0]!.description = 'Translate text between English and French';
    incompatible.offerings[0]!.name = 'translation';
    incompatible.offerings[0]!.deliverable = 'Translated text';
    const adapter = new VirtualsAcpAdapter(
      client({ browseAgents: vi.fn().mockResolvedValue([incompatible]) }),
      8453,
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
    const adapter = new VirtualsAcpAdapter(sdk, 8453);
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
      client({ browseAgents: vi.fn().mockRejectedValue(new Error('secret upstream body')) }),
      8453,
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
