import type { AcpAgentOffering } from '@virtuals-protocol/acp-node-v2';
import { describe, expect, it } from 'vitest';
import { analyzeOfferingCompatibility } from '../../src/integrations/virtuals/offering-compatibility.js';

function offering(overrides: Partial<AcpAgentOffering> = {}): AcpAgentOffering {
  return {
    name: 'verified-research',
    description: 'Research and fact verification using cited web sources',
    requirements: {
      type: 'object',
      properties: { topic: { type: 'string', description: 'Research topic' } },
    },
    deliverable: {
      type: 'object',
      properties: { summary: { type: 'string' }, sources: { type: 'array' } },
    },
    slaMinutes: 10,
    priceType: 'fixed',
    priceValue: 0.25,
    requiredFunds: true,
    isHidden: false,
    isPrivate: false,
    ...overrides,
  };
}

describe('Virtuals offering semantic compatibility', () => {
  it('accepts exact capability semantics and preserves raw schemas', () => {
    const result = analyzeOfferingCompatibility(offering(), ['research', 'fact verification']);
    expect(result).toMatchObject({
      compatible: true,
      matchedCapabilities: ['research', 'fact-verification'],
      missingCapabilities: [],
      score: 1,
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
    });
  });

  it('rejects a partial match because hard constraints precede scoring', () => {
    const result = analyzeOfferingCompatibility(offering(), ['research', 'translation']);
    expect(result).toMatchObject({
      compatible: false,
      matchedCapabilities: ['research'],
      missingCapabilities: ['translation'],
      score: 0.5,
    });
  });

  it('rejects an incompatible offering', () => {
    const result = analyzeOfferingCompatibility(
      offering({ name: 'image-generation', description: 'Create illustrated images' }),
      ['research'],
    );
    // Schema text still says research in the base fixture, so replace it too.
    const strict = analyzeOfferingCompatibility(
      offering({
        name: 'image-generation',
        description: 'Create illustrated images',
        requirements: { properties: { prompt: { type: 'string' } } },
        deliverable: { properties: { imageUrl: { type: 'string' } } },
      }),
      ['research'],
    );
    expect(result.matchedCapabilities).toContain('research');
    expect(strict).toMatchObject({ compatible: false, missingCapabilities: ['research'] });
  });

  it('rejects missing metadata and malformed price metadata', () => {
    expect(
      analyzeOfferingCompatibility(
        offering({ name: '', description: '', requirements: '', deliverable: '' }),
        ['research'],
      ).compatible,
    ).toBe(false);
    expect(
      analyzeOfferingCompatibility(offering({ priceValue: Number.NaN }), ['research']).compatible,
    ).toBe(false);
  });

  it('extracts explicitly advertised capabilities when present', () => {
    const result = analyzeOfferingCompatibility(
      offering({ requirements: { capabilities: ['research', 'fact verification'] } }),
      ['research'],
    );
    expect(result.advertisedCapabilities).toEqual(['research', 'fact-verification']);
  });
});
