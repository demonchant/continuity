import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { MemoryProvider } from './memory-provider.js';
import type {
  MemoryQuery,
  MemoryRecallResult,
  MemoryRecord,
  MemoryWriteReceipt,
  NewMemoryRecord,
  RecoveryCheckpointInput,
} from './memory-record.js';

export interface MemoryServiceOptions {
  readonly now?: () => Date;
  readonly id?: () => string;
}

export class MemoryService {
  private readonly now: () => Date;
  private readonly id: () => string;

  constructor(
    private readonly provider: MemoryProvider,
    private readonly logger: Logger,
    options: MemoryServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? randomUUID;
  }

  async recall(query: MemoryQuery): Promise<MemoryRecallResult> {
    const text = this.buildRecallQuery(query);
    const limit = Math.min(Math.max(query.limit ?? 10, 1), 50);
    this.logger.info(
      {
        event: 'memory.read',
        provider: this.provider.providerName,
        categories: query.categories,
        limit,
      },
      'Sibyl memory read',
    );

    const records = await this.provider.search({
      text,
      ...(query.categories ? { categories: query.categories } : {}),
      limit,
    });

    this.logger.info(
      {
        event: 'memory.result',
        provider: this.provider.providerName,
        count: records.length,
        recordIds: records.map(({ sibylRecordId }) => sibylRecordId),
      },
      'Sibyl memory result',
    );
    return { provider: 'sibyl', query: text, records };
  }

  async remember(input: NewMemoryRecord): Promise<MemoryRecord> {
    const record = this.materialize(input);
    await this.write(record, false);
    return record;
  }

  async rememberWithReceipt(input: NewMemoryRecord): Promise<MemoryWriteReceipt> {
    const record = this.materialize(input);
    return this.write(record, false);
  }

  recordExperience(input: Omit<NewMemoryRecord, 'category'>): Promise<MemoryRecord> {
    return this.recordExperienceWithReceipt(input).then(({ record }) => record);
  }

  recordExperienceWithReceipt(
    input: Omit<NewMemoryRecord, 'category'>,
  ): Promise<MemoryWriteReceipt> {
    return this.rememberAndRecord({ ...input, category: 'experience' });
  }

  recordDecision(input: Omit<NewMemoryRecord, 'category'>): Promise<MemoryRecord> {
    return this.rememberAndRecord({ ...input, category: 'decision' }).then(({ record }) => record);
  }

  recordOutcome(input: Omit<NewMemoryRecord, 'category'>): Promise<MemoryRecord> {
    return this.recordOutcomeWithReceipt(input).then(({ record }) => record);
  }

  recordOutcomeWithReceipt(input: Omit<NewMemoryRecord, 'category'>): Promise<MemoryWriteReceipt> {
    return this.rememberAndRecord({ ...input, category: 'outcome' });
  }

  recordFailure(input: Omit<NewMemoryRecord, 'category' | 'success'>): Promise<MemoryRecord> {
    return this.recordFailureWithReceipt(input).then(({ record }) => record);
  }

  recordFailureWithReceipt(
    input: Omit<NewMemoryRecord, 'category' | 'success'>,
  ): Promise<MemoryWriteReceipt> {
    return this.rememberAndRecord({ ...input, category: 'failure', success: false });
  }

  async recordCheckpoint(input: RecoveryCheckpointInput): Promise<MemoryRecord> {
    const { state, nextAction, ...recordInput } = input;
    const record = this.materialize(recordInput);
    await this.write(record, true);
    await this.provider.setCheckpoint(record, state, nextAction);
    return record;
  }

  close(): Promise<void> {
    return this.provider.close();
  }

  private async rememberAndRecord(input: NewMemoryRecord): Promise<MemoryWriteReceipt> {
    const record = this.materialize(input);
    return this.write(record, true);
  }

  private async write(record: MemoryRecord, appendEvent: boolean): Promise<MemoryWriteReceipt> {
    this.logger.info(
      {
        event: 'memory.write',
        provider: this.provider.providerName,
        category: record.category,
        recordId: record.id,
        missionId: record.missionId,
      },
      'Sibyl memory write',
    );
    const sibylRecordId = await this.provider.remember(record);
    const sibylEventId = appendEvent ? await this.provider.recordEvent(record) : undefined;
    this.logger.info(
      {
        event: 'memory.result',
        provider: this.provider.providerName,
        operation: 'write',
        category: record.category,
        recordId: record.id,
        sibylRecordId,
        sibylEventId,
      },
      'Sibyl memory result',
    );
    return {
      record,
      sibylRecordId,
      ...(sibylEventId ? { sibylEventId } : {}),
    };
  }

  private materialize(input: NewMemoryRecord): MemoryRecord {
    return Object.freeze({
      ...input,
      schemaVersion: 1 as const,
      id: input.id ?? `continuity-${this.id()}`,
      timestamp: input.timestamp ?? this.now().toISOString(),
    });
  }

  private buildRecallQuery(query: MemoryQuery): string {
    // Sibyl is FTS5-based (not an embedding service). Capability is the most
    // conservative comparable-mission key; fall back to the mission text only
    // when the caller has no normalized capability yet.
    const terms = query.capabilities.length > 0 ? query.capabilities : [query.mission];
    return [...new Set(terms.map((term) => term.trim()).filter(Boolean))].join(' ');
  }
}
