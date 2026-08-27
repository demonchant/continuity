import type { MemoryProvider, ProviderRecallQuery } from '../../src/memory/memory-provider.js';
import type { MemoryRecord, RecalledMemory } from '../../src/memory/memory-record.js';

/** Test-only memory adapter. It is never imported by production source. */
export class MockMemoryProvider implements MemoryProvider {
  readonly providerName = 'sibyl' as const;
  readonly records: MemoryRecord[] = [];
  readonly events: MemoryRecord[] = [];
  readonly checkpoints: { record: MemoryRecord; state: string; nextAction: string }[] = [];
  readonly searches: ProviderRecallQuery[] = [];

  searchResult: readonly RecalledMemory[] = [];

  search(query: ProviderRecallQuery): Promise<readonly RecalledMemory[]> {
    this.searches.push(query);
    return Promise.resolve(this.searchResult);
  }

  remember(record: MemoryRecord): Promise<string> {
    this.records.push(record);
    return Promise.resolve(`sibyl-record-${record.id}`);
  }

  recordEvent(record: MemoryRecord): Promise<string> {
    this.events.push(record);
    return Promise.resolve(`sibyl-event-${record.id}`);
  }

  setCheckpoint(record: MemoryRecord, state: string, nextAction: string): Promise<void> {
    this.checkpoints.push({ record, state, nextAction });
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
