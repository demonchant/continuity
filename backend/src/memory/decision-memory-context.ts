import { MemoryUnavailableError } from './memory-provider.js';
import type { MemoryQuery, RecalledMemory } from './memory-record.js';
import type { MemoryService } from './memory-service.js';

export type DecisionMemoryContext =
  | {
      readonly historicalExperience: 'available';
      readonly evidence: readonly RecalledMemory[];
      readonly citedSibylRecordIds: readonly string[];
      readonly recommendations: readonly string[];
      readonly avoidAgentIds: readonly string[];
    }
  | {
      readonly historicalExperience: 'unavailable';
      readonly reason: 'MEMORY_DISABLED' | 'SIBYL_UNAVAILABLE';
      readonly evidence: readonly [];
      readonly citedSibylRecordIds: readonly [];
      readonly recommendations: readonly [];
      readonly avoidAgentIds: readonly [];
    };

/**
 * The decision-facing read boundary. The decision engine consumes this output;
 * it must not query PostgreSQL or rebuild historical signals elsewhere.
 */
export async function loadDecisionMemoryContext(
  memory: MemoryService,
  query: MemoryQuery,
): Promise<DecisionMemoryContext> {
  try {
    const recall = await memory.recall(query);
    const recommendations = recall.records.flatMap(({ record }) =>
      record.recommendation ? [record.recommendation] : [],
    );
    const avoidAgentIds = recall.records.flatMap(({ record }) =>
      record.category === 'failure' && record.agentId ? [record.agentId] : [],
    );

    return {
      historicalExperience: 'available',
      evidence: recall.records,
      citedSibylRecordIds: recall.records.map(({ sibylRecordId }) => sibylRecordId),
      recommendations: [...new Set(recommendations)],
      avoidAgentIds: [...new Set(avoidAgentIds)],
    };
  } catch (error) {
    if (error instanceof MemoryUnavailableError) {
      return {
        historicalExperience: 'unavailable',
        reason: error.code,
        evidence: [],
        citedSibylRecordIds: [],
        recommendations: [],
        avoidAgentIds: [],
      };
    }
    throw error;
  }
}
