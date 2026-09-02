import { describe, expect, it } from 'vitest';
import { createAcpEvidence, sha256Evidence } from '../../src/verification/evidence-hash.js';

describe('SHA-256 ACP evidence', () => {
  it('produces the same hash for canonically identical evidence', () => {
    const first = sha256Evidence({ summary: 'done', metrics: { b: 2, a: 1 } });
    const second = sha256Evidence({ metrics: { a: 1, b: 2 }, summary: 'done' });
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });

  it('changes when evidence changes', () => {
    expect(sha256Evidence({ summary: 'done' })).not.toBe(sha256Evidence({ summary: 'modified' }));
  });

  it('redacts secret values before hashing and attaches safe provenance', () => {
    const metadata = {
      acpJobId: '99',
      providerId: 'provider-1',
      offeringId: 'offering-1',
      jobCreatedAt: '2026-09-02T12:00:00.000Z',
      evidenceCapturedAt: '2026-09-02T12:01:00.000Z',
    };
    const left = createAcpEvidence({ output: 'done', accessToken: 'first-secret' }, metadata);
    const right = createAcpEvidence({ accessToken: 'second-secret', output: 'done' }, metadata);
    expect(left.evidenceHash).toBe(right.evidenceHash);
    expect(left.provenance).toMatchObject({
      algorithm: 'SHA-256',
      canonicalization: 'continuity-json-v1',
      ...metadata,
    });
  });
});
