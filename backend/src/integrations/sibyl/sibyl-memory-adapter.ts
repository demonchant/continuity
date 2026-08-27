import {
  MemoryUnavailableError,
  type MemoryProvider,
  type ProviderRecallQuery,
} from '../../memory/memory-provider.js';
import {
  memoryCategories,
  type MemoryCategory,
  type MemoryRecord,
  type RecalledMemory,
} from '../../memory/memory-record.js';
import type { SibylToolClient, SibylToolResult } from './sibyl-tool-client.js';

const categoryPrefix = 'continuity_';
const categorySet = new Set<string>(memoryCategories);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function payloadOf(result: SibylToolResult): Record<string, unknown> {
  if (result.isError) throw new Error('Sibyl MCP tool returned an error');
  if (result.structuredContent && isObject(result.structuredContent)) {
    return result.structuredContent;
  }
  const text = result.content?.find((item) => item.type === 'text')?.text;
  if (!text) throw new Error('Sibyl MCP tool returned no structured result');
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed)) throw new Error('Sibyl MCP tool result was not an object');
  return parsed;
}

function isMemoryRecord(value: unknown): value is MemoryRecord {
  if (!isObject(value)) return false;
  return (
    value.schemaVersion === 1 &&
    typeof value.id === 'string' &&
    typeof value.category === 'string' &&
    categorySet.has(value.category) &&
    typeof value.timestamp === 'string' &&
    typeof value.missionId === 'string' &&
    typeof value.mission === 'string' &&
    typeof value.capability === 'string'
  );
}

function findRecord(value: unknown, depth = 0): MemoryRecord | undefined {
  if (depth > 4) return undefined;
  if (isMemoryRecord(value)) return value;
  if (!isObject(value)) return undefined;
  for (const key of ['body', 'acted', 'entity']) {
    const found = findRecord(value[key], depth + 1);
    if (found) return found;
  }
  return undefined;
}

function providerId(hit: Record<string, unknown>, record: MemoryRecord): string {
  const id = hit.id ?? hit.event_id ?? hit.rowid ?? hit.key;
  return typeof id === 'string' || typeof id === 'number'
    ? String(id)
    : `sibyl:${categoryPrefix}${record.category}:${record.id}`;
}

/**
 * Production adapter. These are the only official Sibyl tool names used by
 * Continuity; application code never constructs an MCP payload directly.
 */
export class SibylMemoryAdapter implements MemoryProvider {
  readonly providerName = 'sibyl' as const;

  constructor(private readonly client: SibylToolClient) {}

  async search(query: ProviderRecallQuery): Promise<readonly RecalledMemory[]> {
    try {
      const payload = payloadOf(
        await this.client.call('memory_search', {
          query: query.text,
          limit: query.limit,
          tiers: 'entity,journal',
        }),
      );
      const results = Array.isArray(payload.results) ? payload.results : [];
      const recalled = new Map<string, RecalledMemory>();
      for (const value of results) {
        if (!isObject(value)) continue;
        const tier = typeof value.tier === 'string' ? value.tier : 'entity';
        let record = findRecord(value);
        let exactEntity: Record<string, unknown> | undefined;

        // Current Sibyl releases cap search bodies and may return a JSON string
        // marked truncated. Resolve Continuity entities with the supported exact
        // recall tool before parsing so decisions never consume a partial record.
        if (
          tier === 'entity' &&
          typeof value.category === 'string' &&
          value.category.startsWith(categoryPrefix) &&
          typeof value.key === 'string'
        ) {
          const exact = payloadOf(
            await this.client.call('memory_recall', {
              category: value.category,
              name: value.key,
            }),
          );
          exactEntity = isObject(exact.entity) ? exact.entity : undefined;
          record = findRecord(exactEntity) ?? record;
        }
        if (!record || (query.categories && !query.categories.includes(record.category))) continue;
        const score = value.score ?? value.rank;
        let sibylRecordId = providerId(value, record);
        if (typeof exactEntity?.id === 'string' || typeof exactEntity?.id === 'number') {
          sibylRecordId = String(exactEntity.id);
        }
        // The entity and append-only journal event contain the same domain
        // record. Cite the entity once; it has the durable exact-recall ID.
        if (!recalled.has(record.id) || tier === 'entity') {
          recalled.set(record.id, {
            record,
            sibylRecordId,
            sibylTier: tier,
            ...(typeof score === 'number' ? { relevance: score } : {}),
          });
        }
      }
      return [...recalled.values()];
    } catch (error) {
      throw this.unavailable('Sibyl memory search failed', error);
    }
  }

  async remember(record: MemoryRecord): Promise<string> {
    const category = `${categoryPrefix}${record.category}`;
    try {
      payloadOf(
        await this.client.call('memory_remember', {
          category,
          name: record.id,
          body: record,
        }),
      );
      const recalled = payloadOf(
        await this.client.call('memory_recall', { category, name: record.id }),
      );
      const entity = isObject(recalled.entity) ? recalled.entity : undefined;
      const id = entity?.id;
      return typeof id === 'string' || typeof id === 'number'
        ? String(id)
        : `sibyl:${category}:${record.id}`;
    } catch (error) {
      throw this.unavailable('Sibyl memory write failed', error);
    }
  }

  async recordEvent(record: MemoryRecord): Promise<string> {
    try {
      const payload = payloadOf(
        await this.client.call('memory_record_event', {
          kind: record.category,
          body: record,
          category: `${categoryPrefix}${record.category}`,
          name: record.id,
        }),
      );
      return typeof payload.event_id === 'string' ? payload.event_id : `sibyl:event:${record.id}`;
    } catch (error) {
      throw this.unavailable('Sibyl journal write failed', error);
    }
  }

  async setCheckpoint(record: MemoryRecord, state: string, nextAction: string): Promise<void> {
    try {
      payloadOf(
        await this.client.call('memory_set_state', {
          key: `continuity_checkpoint_${record.missionId}`,
          body: { record, state, nextAction },
        }),
      );
    } catch (error) {
      throw this.unavailable('Sibyl checkpoint write failed', error);
    }
  }

  close(): Promise<void> {
    return this.client.close();
  }

  private unavailable(message: string, cause: unknown): MemoryUnavailableError {
    return new MemoryUnavailableError('SIBYL_UNAVAILABLE', message, { cause });
  }
}

export function sibylCategory(category: MemoryCategory): string {
  return `${categoryPrefix}${category}`;
}
