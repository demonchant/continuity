import type { AcpAgentOffering } from '@virtuals-protocol/acp-node-v2';
import { normalizeCapability } from '../../agents/agent.js';
import type { JsonObject, JsonValue } from '../../missions/mission.js';

export interface OfferingCompatibility {
  readonly compatible: boolean;
  readonly normalizedCapabilities: readonly string[];
  readonly matchedCapabilities: readonly string[];
  readonly missingCapabilities: readonly string[];
  readonly advertisedCapabilities: readonly string[];
  readonly score: number;
  readonly reasons: readonly string[];
  readonly inputSchema?: JsonValue;
  readonly outputSchema?: JsonValue;
  readonly rawMetadata: JsonObject;
}

function safeJson(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(safeJson);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) =>
        item === undefined ? [] : [[key, safeJson(item)]],
      ),
    );
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return null;
  return `[unsupported-${typeof value}]`;
}

function strings(value: unknown, depth = 0): readonly string[] {
  if (depth > 8 || value === null || value === undefined) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => strings(item, depth + 1));
  if (typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => [key, ...strings(item, depth + 1)]);
}

function explicitCapabilities(value: unknown, depth = 0): readonly string[] {
  if (depth > 8 || !value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => {
    const normalizedKey = normalizeCapability(key);
    if (
      ['capability', 'capabilities', 'category', 'categories', 'tag', 'tags'].includes(
        normalizedKey,
      )
    ) {
      const values = Array.isArray(item) ? item : [item];
      return values
        .filter((entry): entry is string => typeof entry === 'string')
        .map(normalizeCapability)
        .filter(Boolean);
    }
    return explicitCapabilities(item, depth + 1);
  });
}

function semanticTokens(value: string): ReadonlySet<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 1),
  );
}

function capabilityMatches(
  capability: string,
  corpus: string,
  tokens: ReadonlySet<string>,
): boolean {
  const words = capability.split('-').filter(Boolean);
  return (
    corpus.includes(capability) || (words.length > 0 && words.every((word) => tokens.has(word)))
  );
}

/** Hard compatibility gate derived only from the offering's actual metadata. */
export function analyzeOfferingCompatibility(
  offering: AcpAgentOffering,
  requestedCapabilities: readonly string[],
): OfferingCompatibility {
  const normalizedCapabilities = [
    ...new Set(requestedCapabilities.map(normalizeCapability).filter(Boolean)),
  ];
  const metadataValues = [
    offering.name,
    offering.description,
    offering.requirements,
    offering.deliverable,
  ];
  const corpus = strings(metadataValues)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  const tokens = semanticTokens(strings(metadataValues).join(' '));
  const advertisedCapabilities = [
    ...new Set(
      [
        ...explicitCapabilities(offering.requirements),
        ...explicitCapabilities(offering.deliverable),
      ].filter(Boolean),
    ),
  ];
  const matchedCapabilities = normalizedCapabilities.filter((capability) =>
    capabilityMatches(capability, corpus, tokens),
  );
  const missingCapabilities = normalizedCapabilities.filter(
    (capability) => !matchedCapabilities.includes(capability),
  );
  const metadataPresent =
    offering.name.trim().length > 0 &&
    [offering.description, offering.requirements, offering.deliverable].some(
      (value) => strings(value).join('').trim().length > 0,
    );
  const structurallyValid =
    Number.isFinite(offering.priceValue) &&
    offering.priceValue >= 0 &&
    (typeof offering.requirements === 'string' ||
      (typeof offering.requirements === 'object' && offering.requirements !== null)) &&
    (typeof offering.deliverable === 'string' ||
      (typeof offering.deliverable === 'object' && offering.deliverable !== null));
  const compatible =
    metadataPresent &&
    structurallyValid &&
    normalizedCapabilities.length > 0 &&
    missingCapabilities.length === 0;
  const score =
    normalizedCapabilities.length === 0
      ? 0
      : Math.round((matchedCapabilities.length / normalizedCapabilities.length) * 10_000) / 10_000;
  const reasons = [
    metadataPresent ? 'Offering metadata is present.' : 'Offering metadata is missing.',
    structurallyValid
      ? 'Offering metadata is structurally valid.'
      : 'Offering metadata is malformed.',
    ...matchedCapabilities.map(
      (capability) => `Capability ${capability} is supported by offering semantics.`,
    ),
    ...missingCapabilities.map(
      (capability) => `Capability ${capability} is not established by offering semantics.`,
    ),
  ];
  return {
    compatible,
    normalizedCapabilities,
    matchedCapabilities,
    missingCapabilities,
    advertisedCapabilities,
    score,
    reasons,
    inputSchema: safeJson(offering.requirements),
    outputSchema: safeJson(offering.deliverable),
    rawMetadata: {
      name: offering.name,
      description: offering.description,
      requirements: safeJson(offering.requirements),
      deliverable: safeJson(offering.deliverable),
      slaMinutes: offering.slaMinutes,
      priceType: offering.priceType,
      priceValue: offering.priceValue,
      requiredFunds: offering.requiredFunds,
      isHidden: offering.isHidden,
      isPrivate: offering.isPrivate,
    },
  };
}
