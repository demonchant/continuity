import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { JsonObject, JsonValue } from '../missions/mission.js';
import type { MemoryService } from '../memory/memory-service.js';
import type {
  AgentResult,
  VerificationCheck,
  VerificationOutputFormat,
  VerificationReport,
  VerificationRequest,
} from './verification.js';

export const verifierVersion = 'continuity-deterministic-v1';

interface VerificationServiceOptions {
  readonly id?: () => string;
}

interface DeclaredRequirements {
  readonly outputFormat?: VerificationOutputFormat;
  readonly requiredFields: readonly string[];
  readonly requiredSources: number;
  readonly requireEvidence: boolean;
  readonly requiredTerms: readonly string[];
  readonly prohibitedTerms: readonly string[];
  readonly minWords?: number;
  readonly maxWords?: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonObject(value: JsonValue | undefined): JsonObject | undefined {
  return value !== undefined && typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : undefined;
}

function strings(value: JsonValue | undefined): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function nonNegativeInteger(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function positiveInteger(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function requirements(constraints: JsonObject): DeclaredRequirements {
  const output = jsonObject(constraints.output);
  const rawFormat = output?.format;
  const outputFormat =
    rawFormat === 'json' || rawFormat === 'object' || rawFormat === 'array' || rawFormat === 'text'
      ? rawFormat
      : undefined;
  const requiredFields = [
    ...new Set([...strings(constraints.requiredFields), ...strings(output?.requiredFields)]),
  ];
  const minWords = positiveInteger(constraints.minWords);
  const maxWords = positiveInteger(constraints.maxWords);
  return {
    ...(outputFormat ? { outputFormat } : {}),
    requiredFields,
    requiredSources: nonNegativeInteger(constraints.requiredSources) ?? 0,
    requireEvidence: constraints.requireEvidence === true,
    requiredTerms: strings(constraints.requiredTerms),
    prohibitedTerms: strings(constraints.prohibitedTerms),
    ...(minWords !== undefined ? { minWords } : {}),
    ...(maxWords !== undefined ? { maxWords } : {}),
  };
}

function parsedOutput(output: unknown): { readonly value: unknown; readonly validJson: boolean } {
  if (typeof output !== 'string') return { value: output, validJson: true };
  try {
    return { value: JSON.parse(output) as unknown, validJson: true };
  } catch {
    return { value: output, validJson: false };
  }
}

function hasContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return true;
}

function nestedValue(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split('.').filter(Boolean)) {
    if (!isObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function formatPassed(
  format: VerificationOutputFormat,
  raw: unknown,
  parsed: { readonly value: unknown; readonly validJson: boolean },
): boolean {
  switch (format) {
    case 'json':
      return typeof raw !== 'string' || parsed.validJson;
    case 'object':
      return isObject(parsed.value);
    case 'array':
      return Array.isArray(parsed.value);
    case 'text':
      return typeof raw === 'string';
  }
}

function outputArray(value: unknown, key: string): readonly unknown[] {
  return isObject(value) && Array.isArray(value[key]) ? value[key] : [];
}

function validSource(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (!isObject(value)) return false;
  return [value.url, value.title, value.reference].some(
    (part) => typeof part === 'string' && part.trim().length > 0,
  );
}

function sourceIdentity(value: unknown): string | null {
  if (!validSource(value)) return null;
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (!isObject(value)) return null;
  const identity = value.url ?? value.reference ?? value.title;
  return typeof identity === 'string' ? identity.trim().toLowerCase() : null;
}

function statusConsistent(value: unknown): boolean {
  if (!isObject(value) || typeof value.success !== 'boolean' || typeof value.status !== 'string') {
    return true;
  }
  const status = value.status.trim().toLowerCase();
  const successful = new Set(['complete', 'completed', 'pass', 'passed', 'success', 'succeeded']);
  const failed = new Set(['error', 'fail', 'failed', 'rejected']);
  if (successful.has(status)) return value.success;
  if (failed.has(status)) return !value.success;
  return true;
}

function searchableText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function wordCount(value: string): number {
  return value.trim().match(/\S+/g)?.length ?? 0;
}

function containsTerm(value: string, term: string): boolean {
  const escaped = term
    .trim()
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(value);
}

function addCheck(
  checks: VerificationCheck[],
  requirement: string,
  passed: boolean,
  passReason: string,
  failReason: string,
): void {
  checks.push({ requirement, passed, reason: passed ? passReason : failReason });
}

function evaluate(
  result: AgentResult,
  declared: DeclaredRequirements,
): readonly VerificationCheck[] {
  const checks: VerificationCheck[] = [];
  const parsed = parsedOutput(result.output);
  const text = searchableText(parsed.value);

  addCheck(
    checks,
    'completeness',
    hasContent(parsed.value),
    'The result contains substantive output.',
    'The result is empty or incomplete.',
  );
  addCheck(
    checks,
    'basicConsistency',
    statusConsistent(parsed.value),
    'Result status fields are internally consistent.',
    'Result status and success fields contradict each other.',
  );

  if (declared.outputFormat) {
    const passed = formatPassed(declared.outputFormat, result.output, parsed);
    addCheck(
      checks,
      'outputFormat',
      passed,
      `The result satisfies the required ${declared.outputFormat} format.`,
      `The result does not satisfy the required ${declared.outputFormat} format.`,
    );
  }

  for (const field of declared.requiredFields) {
    const passed = hasContent(nestedValue(parsed.value, field));
    addCheck(
      checks,
      `requiredField:${field}`,
      passed,
      `Required field "${field}" is present.`,
      `Required field "${field}" is missing or empty.`,
    );
  }

  if (declared.requiredSources > 0) {
    const sources = new Set(
      [...(result.sources ?? []), ...outputArray(parsed.value, 'sources')]
        .map(sourceIdentity)
        .filter((source): source is string => source !== null),
    );
    const passed = sources.size >= declared.requiredSources;
    addCheck(
      checks,
      'requiredSources',
      passed,
      `${sources.size} distinct valid sources satisfy the required minimum of ${declared.requiredSources}.`,
      `Only ${sources.size} distinct valid sources were supplied; ${declared.requiredSources} are required.`,
    );
  }

  if (declared.requireEvidence) {
    const evidence = [...(result.evidence ?? []), ...outputArray(parsed.value, 'evidence')].filter(
      hasContent,
    );
    addCheck(
      checks,
      'evidencePresence',
      evidence.length > 0,
      'Supporting evidence is present.',
      'Supporting evidence is required but missing.',
    );
  }

  const lowerText = text.toLowerCase();
  for (const term of declared.requiredTerms) {
    const passed = containsTerm(lowerText, term);
    addCheck(
      checks,
      `requiredTerm:${term}`,
      passed,
      `Required content "${term}" is present.`,
      `Required content "${term}" is missing.`,
    );
  }
  for (const term of declared.prohibitedTerms) {
    const passed = !containsTerm(lowerText, term);
    addCheck(
      checks,
      `prohibitedTerm:${term}`,
      passed,
      `Prohibited content "${term}" is absent.`,
      `Prohibited content "${term}" is present.`,
    );
  }

  const words = wordCount(text);
  if (declared.minWords !== undefined) {
    addCheck(
      checks,
      'minWords',
      words >= declared.minWords,
      `The result contains at least ${declared.minWords} words.`,
      `The result contains ${words} words; at least ${declared.minWords} are required.`,
    );
  }
  if (declared.maxWords !== undefined) {
    addCheck(
      checks,
      'maxWords',
      words <= declared.maxWords,
      `The result stays within the ${declared.maxWords}-word limit.`,
      `The result contains ${words} words, exceeding the ${declared.maxWords}-word limit.`,
    );
  }
  return checks;
}

function roundedScore(checks: readonly VerificationCheck[]): number {
  const passed = checks.filter((check) => check.passed).length;
  return Math.round((passed / checks.length) * 10_000) / 10_000;
}

export class VerificationService {
  private readonly id: () => string;

  constructor(
    private readonly memory: MemoryService,
    private readonly logger: Logger,
    options: VerificationServiceOptions = {},
  ) {
    this.id = options.id ?? randomUUID;
  }

  async verify(request: VerificationRequest): Promise<VerificationReport> {
    const reportId = `verification-${this.id()}`;
    const checks = evaluate(request.result, requirements(request.mission.constraints));
    const failedChecks = checks.filter((check) => !check.passed);
    const passed = failedChecks.length === 0;
    const score = roundedScore(checks);
    const failedRequirements = failedChecks.map(({ requirement }) => requirement);
    const reasons = passed
      ? [`All ${checks.length} verification requirements passed.`]
      : failedChecks.map(({ reason }) => reason);
    const summary = passed
      ? `Verification passed with score ${score}.`
      : `Verification failed with score ${score}: ${reasons.join(' ')}`;

    this.logger.info(
      {
        event: 'verification.result',
        verificationId: reportId,
        missionId: request.mission.id,
        agentId: request.agent.id,
        passed,
        score,
        failedRequirements,
      },
      'Agent result verification completed',
    );

    const capabilities = [
      ...new Set(
        request.capability
          .split(',')
          .map((capability) => capability.trim())
          .filter(Boolean),
      ),
    ];
    const memoryInput = {
      missionId: request.mission.id,
      ...(request.mission.organizationId ? { organizationId: request.mission.organizationId } : {}),
      mission: request.mission.objective,
      agentId: request.agent.id,
      agentProvider: request.agent.provider,
      result: summary,
      verification: {
        status: passed ? ('PASS' as const) : ('FAIL' as const),
        summary,
        verifierVersion,
        score,
        failedRequirements,
      },
      ...(request.result.cost ? { cost: request.result.cost } : {}),
      ...(request.result.latencyMs !== undefined ? { latencyMs: request.result.latencyMs } : {}),
      ...(request.result.providerReference
        ? { providerReference: request.result.providerReference }
        : {}),
      ...(request.result.evidenceHash ? { evidenceHash: request.result.evidenceHash } : {}),
      ...(request.result.provenance ? { provenance: request.result.provenance } : {}),
      tags: ['result-verification', reportId],
    };
    const memoryWrites = await Promise.all(
      (capabilities.length > 0 ? capabilities : [request.capability]).map((capability) =>
        passed
          ? this.memory.recordExperienceWithReceipt({
              ...memoryInput,
              capability,
              success: true,
              recommendation: `Prefer ${request.agent.id} for comparable ${capability} work when this verified evidence is relevant.`,
            })
          : this.memory.recordFailureWithReceipt({
              ...memoryInput,
              capability,
              failureReason: reasons.join(' '),
              recommendation: `Penalize ${request.agent.id} for comparable ${capability} work until newer verified evidence addresses: ${failedRequirements.join(', ')}.`,
            }),
      ),
    );
    const memoryWrite = memoryWrites[0]!;
    if (!memoryWrite.sibylEventId) {
      throw new Error('Sibyl did not acknowledge the verification journal event');
    }

    return {
      id: reportId,
      verifierVersion,
      passed,
      score,
      reasons,
      failedRequirements,
      checks,
      memoryRecordId: memoryWrite.record.id,
      sibylRecordId: memoryWrite.sibylRecordId,
      sibylEventId: memoryWrite.sibylEventId,
      ...(request.result.evidenceHash ? { evidenceHash: request.result.evidenceHash } : {}),
      ...(request.result.provenance ? { provenance: request.result.provenance } : {}),
    };
  }
}
