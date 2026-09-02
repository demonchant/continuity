import { describe, expect, it, vi } from 'vitest';
import { VirtualsOAuthDiscoveryClient } from '../../src/integrations/virtuals/virtuals-discovery-client.js';

const wallet = '0x576ce0a71711e0d45d9ede753c355a74a5a4dae9';

function urlText(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function agent(index: number) {
  return {
    id: `agent-${index}`,
    name: `Public Agent ${index}`,
    description: 'Public data analysis agent',
    walletAddress: `0x${String(index).padStart(40, '0')}`,
    chainIds: [{ chainId: 8453 }],
    jobOfferings: [
      {
        id: `offering-${index}`,
        name: 'data_analysis',
        description: 'Analyze public data and return a structured report',
        requirement: { type: 'object', properties: { topic: { type: 'string' } } },
        deliverable: { type: 'object', properties: { summary: { type: 'string' } } },
        price: index / 100,
        priceType: 'fixed',
        slaMinutes: 30,
        requiredFunds: false,
        isHidden: false,
        isPrivate: false,
      },
    ],
  };
}

function client(fetcher: typeof fetch) {
  return new VirtualsOAuthDiscoveryClient({
    accessToken: 'access-token-that-is-never-logged',
    refreshToken: 'refresh-token-that-is-never-logged',
    chainId: 8453,
    walletAddressToExclude: wallet,
    timeoutMs: 1_000,
    fetch: fetcher,
  });
}

const request = {
  missionObjective: 'Analyze public data',
  capabilities: ['data analysis'],
  limit: 5,
} as const;

describe('VirtualsOAuthDiscoveryClient', () => {
  it('returns five Base candidates with offering ids and advertised prices', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [1, 2, 3, 4, 5].map(agent) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const candidates = await client(fetcher).discoverCandidates(request);

    expect(candidates).toHaveLength(5);
    expect(candidates[0]).toMatchObject({
      chainId: 8453,
      offeringId: 'offering-1',
      offeringName: 'data_analysis',
      offeringRequirements: { type: 'object' },
      agent: {
        name: 'Public Agent 1',
        cost: { amount: '0.01', currency: 'USDC' },
        metadata: { discoveryMethod: 'VIRTUALS_OAUTH_REST' },
      },
    });
    const [url, init] = fetcher.mock.calls[0]!;
    const parsed = new URL(urlText(url));
    expect(parsed.pathname).toBe('/agents/search');
    expect(parsed.searchParams.get('chainIds')).toBe('8453');
    expect(parsed.searchParams.get('topK')).toBe('5');
    expect(parsed.searchParams.get('isOnline')).toBe('online');
    expect(parsed.searchParams.get('showHidden')).toBe('false');
    expect(parsed.searchParams.get('walletAddressToExclude')).toBe(wallet);
    expect(init?.method).toBe('GET');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('refreshes a rejected bearer and retries only the read-only search', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { token: 'rotated-access', refreshToken: 'rotated-refresh' } }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([agent(1)]), { status: 200 }));

    await expect(client(fetcher).discoverCandidates(request)).resolves.toHaveLength(1);
    expect(
      fetcher.mock.calls.map(([url, init]) => [new URL(urlText(url)).pathname, init?.method]),
    ).toEqual([
      ['/agents/search', 'GET'],
      ['/auth/cli/refresh', 'POST'],
      ['/agents/search', 'GET'],
    ]);
    expect(fetcher.mock.calls.some(([url]) => urlText(url).includes('/wallets/'))).toBe(false);
    expect(fetcher.mock.calls.some(([url]) => urlText(url).includes('/jobs'))).toBe(false);
  });

  it('rejects malformed responses', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [{ unexpected: true }] }), { status: 200 }),
      );
    await expect(client(fetcher).discoverCandidates(request)).rejects.toMatchObject({
      code: 'VIRTUALS_DISCOVERY_FAILED',
      message: 'Virtuals discovery returned a malformed response',
    });
  });

  it.each([401, 403])('maps terminal HTTP %s without exposing credentials', async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('bearer private-key secret', { status }))
      .mockResolvedValueOnce(new Response('refresh-token secret', { status: 401 }));
    const error = await client(fetcher)
      .discoverCandidates(request)
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      code: 'VIRTUALS_DISCOVERY_FAILED',
      message: 'Virtuals OAuth REST discovery failed',
    });
    expect(String((error as Error).cause)).toBe(`Error: HTTP 401`);
    expect(String(error)).not.toMatch(/private-key|refresh-token|bearer/i);
  });

  it('maps an upstream 500 without including its body', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('upstream secret diagnostics', { status: 500 }));
    const error = await client(fetcher)
      .discoverCandidates(request)
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      code: 'VIRTUALS_DISCOVERY_FAILED',
      message: 'Virtuals OAuth REST discovery failed',
    });
    expect(String((error as Error).cause)).toBe('Error: HTTP 500');
    expect(String(error)).not.toContain('upstream secret diagnostics');
  });

  it('maps timeouts safely', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    await expect(client(fetcher).discoverCandidates(request)).rejects.toMatchObject({
      code: 'VIRTUALS_DISCOVERY_FAILED',
      message: 'Virtuals OAuth REST discovery failed',
    });
  });
});
