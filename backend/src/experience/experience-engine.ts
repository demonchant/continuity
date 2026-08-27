import { normalizeCapability } from '../agents/agent.js';
import type { RecalledMemory } from '../memory/memory-record.js';
import type {
  AgentExperienceEvaluation,
  CapabilityExperienceProfile,
  ExperienceCost,
  ExperienceFailurePattern,
  ExperienceQuery,
} from './experience.js';

interface Observation {
  readonly memory: RecalledMemory;
  readonly success: boolean;
  readonly verified: boolean;
  readonly verificationPassed: boolean;
  readonly similar: boolean;
  readonly recent: boolean;
  readonly stale: boolean;
  readonly weight: number;
  readonly timestamp: number;
}

const experienceCategories = new Set(['outcome', 'failure', 'experience']);
const dayMs = 24 * 60 * 60 * 1000;
const recentWindowMs = 90 * dayMs;
const staleWindowMs = 365 * dayMs;
const stopWords = new Set([
  'about',
  'and',
  'for',
  'from',
  'information',
  'into',
  'the',
  'this',
  'with',
]);

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function clamp(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function missionTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((token) => token.length >= 3 && !stopWords.has(token)) ?? [],
  );
}

function missionSimilarity(left: string, right: string): number {
  const leftTokens = missionTokens(left);
  const rightTokens = missionTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function classify(memory: RecalledMemory, mission: string, asOf: Date): Observation | null {
  const { record } = memory;
  const failed =
    record.category === 'failure' ||
    record.success === false ||
    record.verification?.status === 'FAIL';
  const success = !failed && (record.success === true || record.verification?.status === 'PASS');
  if (!failed && !success) return null;

  const timestamp = Date.parse(record.timestamp);
  const age = asOf.getTime() - timestamp;
  if (!Number.isFinite(timestamp) || age < 0) return null;
  const recent = age <= recentWindowMs;
  const stale = age > staleWindowMs;
  const recencyWeight = recent ? 1 : stale ? 0.15 : 0.5;
  const similar = missionSimilarity(mission, record.mission) >= 0.25;
  const similarityWeight = similar ? 1.25 : 0.35;
  const verificationWeight =
    record.verification?.status === 'PASS' || record.verification?.status === 'FAIL' ? 1.1 : 0.75;
  return {
    memory,
    success,
    verified: record.verification?.status === 'PASS' || record.verification?.status === 'FAIL',
    verificationPassed: record.verification?.status === 'PASS',
    similar,
    recent,
    stale,
    weight: recencyWeight * similarityWeight * verificationWeight,
    timestamp,
  };
}

function failurePatterns(
  observations: readonly Observation[],
): readonly ExperienceFailurePattern[] {
  const counts = new Map<string, number>();
  for (const { memory, success } of observations) {
    if (success) continue;
    const reason =
      memory.record.failureReason ?? memory.record.verification?.summary ?? 'Unspecified failure';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
}

function averageCost(observations: readonly Observation[]): ExperienceCost | null {
  const costs = observations.flatMap(({ memory }) => {
    const cost = memory.record.cost;
    if (!cost) return [];
    const amount = Number(cost.amount);
    return Number.isFinite(amount) && amount >= 0 ? [{ amount, currency: cost.currency }] : [];
  });
  if (costs.length === 0 || new Set(costs.map(({ currency }) => currency)).size !== 1) return null;
  return {
    amount: round(costs.reduce((sum, cost) => sum + cost.amount, 0) / costs.length).toString(),
    currency: costs[0]!.currency,
  };
}

function averageLatency(observations: readonly Observation[]): number | null {
  const latencies = observations.flatMap(({ memory }) => {
    const latency = memory.record.latencyMs;
    return latency !== undefined && Number.isFinite(latency) && latency >= 0 ? [latency] : [];
  });
  return latencies.length === 0
    ? null
    : Math.round(latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length);
}

function rate(observations: readonly Observation[]): number | null {
  if (observations.length === 0) return null;
  return round(observations.filter(({ success }) => success).length / observations.length);
}

function recommendation(
  agentId: string,
  capability: string,
  observations: readonly Observation[],
): string {
  if (observations.length === 0) {
    return `No verified ${capability} experience is available for ${agentId}.`;
  }
  const similarFailures = observations.filter(({ similar, success }) => similar && !success).length;
  const successes = observations.filter(({ success }) => success).length;
  const failures = observations.length - successes;
  if (similarFailures > 0) {
    return `${agentId} failed verification on ${similarFailures} similar ${capability} mission${similarFailures === 1 ? '' : 's'}; penalize comparable work until newer verified success outweighs this negative memory.`;
  }
  if (failures > successes) {
    return `${agentId} has ${failures} failures in ${capability}; prefer alternatives for comparable work.`;
  }
  return `${agentId} has ${successes} successful ${capability} outcome${successes === 1 ? '' : 's'}; prefer it when this evidence is current and comparable.`;
}

function summarizeCapability(
  agentId: string,
  capability: string,
  mission: string,
  memories: readonly RecalledMemory[],
  asOf: Date,
): CapabilityExperienceProfile {
  const observations = memories
    .filter(
      ({ record }) =>
        record.agentId === agentId &&
        experienceCategories.has(record.category) &&
        normalizeCapability(record.capability) === capability,
    )
    .map((memory) => classify(memory, mission, asOf))
    .filter((observation): observation is Observation => observation !== null);
  const totalWeight = observations.reduce((sum, observation) => sum + observation.weight, 0);
  const successWeight = observations.reduce(
    (sum, observation) => sum + (observation.success ? observation.weight : 0),
    0,
  );
  const failureWeight = totalWeight - successWeight;
  const verified = observations.filter(({ verified }) => verified);
  const verifiedWeight = verified.reduce((sum, observation) => sum + observation.weight, 0);
  const verificationPassWeight = verified.reduce(
    (sum, observation) => sum + (observation.verificationPassed ? observation.weight : 0),
    0,
  );
  const reliability = (successWeight + 1) / (totalWeight + 2);
  const verificationSuccess =
    verified.length === 0 ? 0.5 : (verificationPassWeight + 1) / (verifiedWeight + 2);
  const failureRate = totalWeight === 0 ? 0 : failureWeight / totalWeight;
  const historicalScore = clamp(
    0.65 * reliability + 0.2 * verificationSuccess - 0.15 * failureRate,
  );
  const timestamps = observations
    .map(({ timestamp }) => timestamp)
    .sort((left, right) => left - right);
  const successes = observations.filter(({ success }) => success).length;
  const recent = observations.filter(({ recent }) => recent);
  const similar = observations.filter(({ similar }) => similar);

  return {
    agentId,
    capability,
    observationCount: observations.length,
    effectiveSampleSize: round(totalWeight),
    successCount: successes,
    failureCount: observations.length - successes,
    successRate: rate(observations),
    verificationSuccessRate:
      verified.length === 0
        ? null
        : round(
            verified.filter(({ verificationPassed }) => verificationPassed).length /
              verified.length,
          ),
    reliability: round(reliability),
    historicalScore: round(historicalScore),
    confidence: round(totalWeight / (totalWeight + 3)),
    similarMissionOutcomes: similar.length,
    similarMissionSuccessRate: rate(similar),
    recentOutcomeRate: rate(recent),
    staleObservationCount: observations.filter(({ stale }) => stale).length,
    averageCost: averageCost(observations),
    averageLatencyMs: averageLatency(observations),
    failurePatterns: failurePatterns(observations),
    observedFrom: timestamps.length > 0 ? new Date(timestamps[0]!).toISOString() : null,
    observedTo: timestamps.length > 0 ? new Date(timestamps.at(-1)!).toISOString() : null,
    recommendation: recommendation(agentId, capability, observations),
    memoryReferences: observations.map(({ memory }) => memory.sibylRecordId),
  };
}

function combinePatterns(
  profiles: readonly CapabilityExperienceProfile[],
): readonly ExperienceFailurePattern[] {
  const counts = new Map<string, number>();
  for (const { failurePatterns: patterns } of profiles) {
    for (const { reason, count } of patterns) counts.set(reason, (counts.get(reason) ?? 0) + count);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
}

function weightedProfileRate(
  profiles: readonly CapabilityExperienceProfile[],
  select: (profile: CapabilityExperienceProfile) => number | null,
): number | null {
  const available = profiles.filter((profile) => select(profile) !== null);
  const weight = available.reduce((sum, profile) => sum + profile.observationCount, 0);
  if (weight === 0) return null;
  return round(
    available.reduce((sum, profile) => sum + select(profile)! * profile.observationCount, 0) /
      weight,
  );
}

export class ExperienceEngine {
  evaluate(query: ExperienceQuery): AgentExperienceEvaluation {
    const asOf = query.asOf ?? new Date();
    const capabilities = [...new Set(query.capabilities.map(normalizeCapability).filter(Boolean))];
    const profiles = capabilities.map((capability) =>
      summarizeCapability(query.agentId, capability, query.mission, query.memories, asOf),
    );
    const historicalScore =
      profiles.length === 0
        ? 0.425
        : profiles.reduce((sum, profile) => sum + profile.historicalScore, 0) / profiles.length;
    const reliability =
      profiles.length === 0
        ? 0.5
        : profiles.reduce((sum, profile) => sum + profile.reliability, 0) / profiles.length;
    const confidence =
      profiles.length === 0
        ? 0
        : profiles.reduce((sum, profile) => sum + profile.confidence, 0) / profiles.length;
    return {
      profiles,
      historicalScore: round(historicalScore),
      observationCount: profiles.reduce((sum, profile) => sum + profile.observationCount, 0),
      successRate: weightedProfileRate(profiles, (profile) => profile.successRate),
      verificationSuccessRate: weightedProfileRate(
        profiles,
        (profile) => profile.verificationSuccessRate,
      ),
      similarMissionOutcomes: profiles.reduce(
        (sum, profile) => sum + profile.similarMissionOutcomes,
        0,
      ),
      recentOutcomeRate: weightedProfileRate(profiles, (profile) => profile.recentOutcomeRate),
      failurePatterns: combinePatterns(profiles),
      reliability: round(reliability),
      confidence: round(confidence),
      memoryReferences: [...new Set(profiles.flatMap((profile) => profile.memoryReferences))],
    };
  }
}
