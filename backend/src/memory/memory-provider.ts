import type { MemoryCategory, MemoryRecord, RecalledMemory } from './memory-record.js';

export interface ProviderRecallQuery {
  readonly text: string;
  readonly categories?: readonly MemoryCategory[];
  readonly limit: number;
}

/** The provider boundary. Production uses Sibyl; tests may supply a test double. */
export interface MemoryProvider {
  readonly providerName: 'sibyl';
  search(query: ProviderRecallQuery): Promise<readonly RecalledMemory[]>;
  remember(record: MemoryRecord): Promise<string>;
  recordEvent(record: MemoryRecord): Promise<string>;
  setCheckpoint(record: MemoryRecord, state: string, nextAction: string): Promise<void>;
  close(): Promise<void>;
}

export class MemoryUnavailableError extends Error {
  readonly code: 'MEMORY_DISABLED' | 'SIBYL_UNAVAILABLE';

  constructor(
    code: 'MEMORY_DISABLED' | 'SIBYL_UNAVAILABLE',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'MemoryUnavailableError';
    this.code = code;
  }
}

/**
 * Explicit non-production deletion-test provider. It never stores or returns
 * data and therefore cannot silently substitute for Sibyl.
 */
export class DisabledMemoryProvider implements MemoryProvider {
  readonly providerName = 'sibyl' as const;

  private unavailable(): MemoryUnavailableError {
    return new MemoryUnavailableError(
      'MEMORY_DISABLED',
      'Sibyl Memory is disabled; historical experience is unavailable',
    );
  }

  search(): Promise<readonly RecalledMemory[]> {
    return Promise.reject(this.unavailable());
  }

  remember(): Promise<string> {
    return Promise.reject(this.unavailable());
  }

  recordEvent(): Promise<string> {
    return Promise.reject(this.unavailable());
  }

  setCheckpoint(): Promise<void> {
    return Promise.reject(this.unavailable());
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
