import { createHash } from 'node:crypto';
import type { JsonObject, JsonValue } from '../missions/mission.js';

const sensitiveKey =
  /^(?:authorization|cookie|password|secret|private[-_]?key|access[-_]?token|refresh[-_]?token|bearer)$/i;

export interface AcpEvidenceProvenance extends JsonObject {
  readonly schemaVersion: 1;
  readonly algorithm: 'SHA-256';
  readonly canonicalization: 'continuity-json-v1';
  readonly acpJobId: string;
  readonly providerId: string;
  readonly offeringId: string;
  readonly jobCreatedAt: string;
  readonly evidenceCapturedAt: string;
}

export interface AcpEvidenceMetadata {
  readonly acpJobId: string;
  readonly providerId: string;
  readonly offeringId: string;
  readonly jobCreatedAt: string;
  readonly evidenceCapturedAt: string;
}

function canonical(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Evidence contains a non-finite number');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => {
      const item = sensitiveKey.test(key) ? '[REDACTED]' : value[key]!;
      return `${JSON.stringify(key)}:${canonical(item)}`;
    })
    .join(',')}}`;
}

/** Stable, secret-aware SHA-256 over the provider result artifact only. */
export function sha256Evidence(value: JsonValue): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

export function createAcpEvidence(
  artifact: JsonValue,
  metadata: AcpEvidenceMetadata,
): { readonly evidenceHash: string; readonly provenance: AcpEvidenceProvenance } {
  return {
    evidenceHash: sha256Evidence(artifact),
    provenance: {
      schemaVersion: 1,
      algorithm: 'SHA-256',
      canonicalization: 'continuity-json-v1',
      ...metadata,
    },
  };
}
