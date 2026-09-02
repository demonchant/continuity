import type { AcpAgentOffering } from '@virtuals-protocol/acp-node-v2';
import { z } from 'zod';
import type { JsonObject, JsonValue } from '../../missions/mission.js';
import type {
  VirtualsAgentCandidate,
  VirtualsAgentDiscoveryRequest,
} from './virtuals-agent-source.js';
import { VirtualsProtocolError } from './virtuals-errors.js';
import type {
  VirtualsDiscoveryCredentialPersistence,
  VirtualsDiscoveryCredentials,
} from './virtuals-discovery-credential-store.js';
import {
  analyzeOfferingCompatibility,
  type OfferingCompatibility,
} from './offering-compatibility.js';

const VIRTUALS_API_URL = 'https://api.acp.virtuals.io';

class SafeHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'SafeHttpError';
  }
}

const offeringSchema = z
  .object({
    id: z.string().min(1).optional(),
    offeringId: z.string().min(1).optional(),
    name: z.string().min(1),
    description: z.string().default(''),
    deliverable: z.unknown().default(''),
    requirement: z.unknown().optional(),
    requirements: z.unknown().optional(),
    slaMinutes: z.coerce.number().nonnegative().default(0),
    price: z.coerce.number().nonnegative().optional(),
    priceValue: z.coerce.number().nonnegative().optional(),
    priceType: z.string().default('fixed'),
    requiredFunds: z.boolean().default(false),
    isHidden: z.boolean().default(false),
    isPrivate: z.boolean().default(false),
  })
  .passthrough()
  .refine((offering) => offering.price !== undefined || offering.priceValue !== undefined, {
    message: 'Offering price is missing',
  });

const chainSchema = z.union([
  z.coerce.number().int().positive(),
  z.object({ chainId: z.coerce.number().int().positive() }).passthrough(),
]);

const agentSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().default(''),
    walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    cluster: z.string().nullable().default(null),
    tag: z.string().nullable().default(null),
    lastActiveAt: z.string().default(''),
    rating: z.coerce.number().nullable().default(null),
    isHidden: z.boolean().default(false),
    chainIds: z.array(chainSchema).optional(),
    chains: z.array(chainSchema).optional(),
    jobOfferings: z.array(offeringSchema).optional(),
    offerings: z.array(offeringSchema).optional(),
  })
  .passthrough();

const searchResponseSchema = z.union([
  z.array(agentSchema),
  z.object({ data: z.array(agentSchema) }).passthrough(),
  z.object({ agents: z.array(agentSchema) }).passthrough(),
]);

const refreshResponseSchema = z.union([
  z.object({ token: z.string().min(1), refreshToken: z.string().min(1) }).passthrough(),
  z
    .object({
      data: z.object({ token: z.string().min(1), refreshToken: z.string().min(1) }).passthrough(),
    })
    .passthrough(),
]);

type SearchAgent = z.infer<typeof agentSchema>;
type SearchOffering = z.infer<typeof offeringSchema>;

export interface VirtualsDiscoveryConfiguration {
  readonly credentials: VirtualsDiscoveryCredentials;
  readonly credentialPersistence: VirtualsDiscoveryCredentialPersistence;
  readonly chainId: number;
  readonly walletAddressToExclude: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

export interface VirtualsDiscoveryClient {
  discoverCandidates(
    request: VirtualsAgentDiscoveryRequest,
  ): Promise<readonly VirtualsAgentCandidate[]>;
}

function safeJson(value: unknown): JsonValue {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return value as JsonValue;
  }
  if (Array.isArray(value)) return value.map(safeJson);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) =>
        item === undefined ? [] : [[key, safeJson(item)]],
      ),
    );
  }
  return `[unsupported-${typeof value}]`;
}

function asOffering(offering: SearchOffering): AcpAgentOffering {
  const requirements = offering.requirements ?? offering.requirement ?? '';
  return {
    name: offering.name,
    description: offering.description,
    deliverable: safeJson(offering.deliverable) as Record<string, unknown> | string,
    requirements: safeJson(requirements) as Record<string, unknown> | string,
    slaMinutes: offering.slaMinutes,
    priceType: offering.priceType,
    priceValue: offering.priceValue ?? offering.price!,
    requiredFunds: offering.requiredFunds,
    isHidden: offering.isHidden,
    isPrivate: offering.isPrivate,
  };
}

function chainIds(agent: SearchAgent): readonly number[] {
  return (agent.chainIds ?? agent.chains ?? []).map((chain) =>
    typeof chain === 'number' ? chain : chain.chainId,
  );
}

function normalizeCandidate(
  detail: SearchAgent,
  rawOffering: SearchOffering,
  offering: AcpAgentOffering,
  chainId: number,
  compatibility: OfferingCompatibility,
): VirtualsAgentCandidate {
  const offeringId = rawOffering.id ?? rawOffering.offeringId;
  const metadata: JsonObject = {
    acpAgentId: detail.id,
    walletAddress: detail.walletAddress,
    chainId,
    cluster: detail.cluster,
    tag: detail.tag,
    lastActiveAt: detail.lastActiveAt,
    rating: detail.rating,
    offeringId: offeringId ?? null,
    offering: safeJson(compatibility.rawMetadata),
    advertisedCapabilities: safeJson(compatibility.advertisedCapabilities),
    matchedCapabilities: safeJson(compatibility.matchedCapabilities),
    compatibilityScore: compatibility.score,
    compatibilityReasons: safeJson(compatibility.reasons),
    inputSchema: safeJson(compatibility.inputSchema),
    outputSchema: safeJson(compatibility.outputSchema),
    discoveryMethod: 'VIRTUALS_OAUTH_REST',
    capabilityBasis:
      'Matched from actual ACP offering name, description, requirements, and deliverable metadata',
  };
  return {
    agent: {
      id: `virtuals:${chainId}:${detail.walletAddress.toLowerCase()}`,
      externalId: detail.walletAddress,
      name: detail.name,
      source: 'EXTERNAL_VIRTUALS',
      provider: 'virtuals',
      capabilities: compatibility.matchedCapabilities,
      status: 'AVAILABLE',
      cost: {
        model: 'FIXED',
        amount: offering.priceValue.toString(),
        currency: 'USDC',
        description: `ACP offering ${offering.name} (${offering.priceType})`,
      },
      metadata,
    },
    chainId,
    providerAddress: detail.walletAddress,
    ...(offeringId ? { offeringId } : {}),
    offeringName: offering.name,
    offeringRequirements: offering.requirements,
    compatibility,
  };
}

function safeStatus(error: unknown): number | undefined {
  return error instanceof SafeHttpError ? error.status : undefined;
}

/**
 * Read-only OAuth boundary. This class exposes no job, wallet, funding, or
 * settlement operation and only calls GET /agents/search plus OAuth refresh.
 */
export class VirtualsOAuthDiscoveryClient implements VirtualsDiscoveryClient {
  private accessToken: string;
  private refreshToken: string;
  private refreshPromise: Promise<void> | undefined;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(private readonly configuration: VirtualsDiscoveryConfiguration) {
    this.accessToken = configuration.credentials.accessToken;
    this.refreshToken = configuration.credentials.refreshToken;
    this.timeoutMs = configuration.timeoutMs ?? 15_000;
    this.fetcher = configuration.fetch ?? fetch;
  }

  async discoverCandidates(
    request: VirtualsAgentDiscoveryRequest,
  ): Promise<readonly VirtualsAgentCandidate[]> {
    try {
      const response = await this.search(request);
      const parsed = searchResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new VirtualsProtocolError(
          'VIRTUALS_DISCOVERY_FAILED',
          'Virtuals discovery returned a malformed response',
          true,
        );
      }
      const payload = parsed.data as
        SearchAgent[] | { readonly agents: SearchAgent[] } | { readonly data: SearchAgent[] };
      let agents: SearchAgent[];
      if (Array.isArray(payload)) agents = payload;
      else if ('agents' in payload) agents = payload.agents;
      else agents = payload.data;
      return agents.flatMap((agent) => {
        if (agent.isHidden || !chainIds(agent).includes(this.configuration.chainId)) return [];
        const selected = (agent.jobOfferings ?? agent.offerings ?? [])
          .map((rawOffering) => {
            const offering = asOffering(rawOffering);
            return {
              rawOffering,
              offering,
              compatibility: analyzeOfferingCompatibility(offering, request.capabilities),
            };
          })
          .filter(
            ({ offering, compatibility }) =>
              !offering.isHidden && !offering.isPrivate && compatibility.compatible,
          )
          .sort(
            (left, right) =>
              right.compatibility.score - left.compatibility.score ||
              left.offering.priceValue - right.offering.priceValue ||
              left.offering.name.localeCompare(right.offering.name),
          )[0];
        return selected
          ? [
              normalizeCandidate(
                agent,
                selected.rawOffering,
                selected.offering,
                this.configuration.chainId,
                selected.compatibility,
              ),
            ]
          : [];
      });
    } catch (error) {
      if (error instanceof VirtualsProtocolError) throw error;
      throw new VirtualsProtocolError(
        'VIRTUALS_DISCOVERY_FAILED',
        'Virtuals OAuth REST discovery failed',
        true,
        { cause: safeStatus(error) ? new Error(`HTTP ${safeStatus(error)}`) : undefined },
      );
    }
  }

  private async search(request: VirtualsAgentDiscoveryRequest): Promise<Response> {
    const url = new URL('/agents/search', VIRTUALS_API_URL);
    url.searchParams.set('query', [request.missionObjective, ...request.capabilities].join(' '));
    url.searchParams.set('chainIds', String(this.configuration.chainId));
    url.searchParams.set('topK', String(Math.min(Math.max(request.limit ?? 5, 1), 20)));
    url.searchParams.set('isOnline', 'online');
    url.searchParams.set('showHidden', 'false');
    url.searchParams.set('walletAddressToExclude', this.configuration.walletAddressToExclude);
    url.searchParams.set('sortBy', 'successfulJobCount,successRate');
    const rejectedAccessToken = this.accessToken;
    let response = await this.authorizedGet(url);
    if (response.status === 401 || response.status === 403) {
      await this.refresh(rejectedAccessToken);
      response = await this.authorizedGet(url);
    }
    if (!response.ok) throw new SafeHttpError(response.status);
    return response;
  }

  private authorizedGet(url: URL): Promise<Response> {
    return this.fetcher(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${this.accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private refresh(rejectedAccessToken: string): Promise<void> {
    if (this.accessToken !== rejectedAccessToken) return Promise.resolve();
    this.refreshPromise ??= this.performRefresh().finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }

  private async performRefresh(): Promise<void> {
    const response = await this.fetcher(new URL('/auth/cli/refresh', VIRTUALS_API_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ refreshToken: this.refreshToken }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new SafeHttpError(response.status);
    const parsed = refreshResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new VirtualsProtocolError(
        'VIRTUALS_DISCOVERY_FAILED',
        'Virtuals OAuth refresh returned a malformed response',
        true,
      );
    }
    const payload = parsed.data as
      | { readonly token: string; readonly refreshToken: string }
      | { readonly data: { readonly token: string; readonly refreshToken: string } };
    const credentials = 'data' in payload ? payload.data : payload;
    try {
      await this.configuration.credentialPersistence.persistRotated({
        accessToken: credentials.token,
        refreshToken: credentials.refreshToken,
      });
    } catch {
      throw new VirtualsProtocolError(
        'VIRTUALS_DISCOVERY_FAILED',
        'Rotated Virtuals discovery credentials could not be persisted',
        true,
      );
    }
    this.accessToken = credentials.token;
    this.refreshToken = credentials.refreshToken;
  }
}
