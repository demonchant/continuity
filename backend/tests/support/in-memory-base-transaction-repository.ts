import { randomUUID } from 'node:crypto';
import type { BaseTransactionRepository } from '../../src/integrations/base/base-transaction-repository.js';
import type {
  BaseTransaction,
  CreateBaseTransactionInput,
  UpdateBaseTransactionInput,
} from '../../src/integrations/base/base-transaction.js';

export class InMemoryBaseTransactionRepository implements BaseTransactionRepository {
  private readonly records = new Map<string, BaseTransaction>();

  createOrGet(input: CreateBaseTransactionInput): Promise<BaseTransaction> {
    const existing = [...this.records.values()].find(
      (item) => item.missionId === input.missionId && item.actionId === input.actionId,
    );
    if (existing) return Promise.resolve(existing);
    const payment = [...this.records.values()].find((item) => item.paymentId === input.paymentId);
    if (payment) return Promise.resolve(payment);
    const now = new Date('2026-08-23T12:00:00.000Z');
    const record: BaseTransaction = {
      id: randomUUID(),
      ...input,
      status: 'INTENDED',
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
    return Promise.resolve(record);
  }

  findById(id: string): Promise<BaseTransaction | null> {
    return Promise.resolve(this.records.get(id) ?? null);
  }

  findByMissionId(missionId: string): Promise<readonly BaseTransaction[]> {
    return Promise.resolve(
      [...this.records.values()].filter((transaction) => transaction.missionId === missionId),
    );
  }

  findByMissionAndAction(missionId: string, actionId: string): Promise<BaseTransaction | null> {
    return Promise.resolve(
      [...this.records.values()].find(
        (item) => item.missionId === missionId && item.actionId === actionId,
      ) ?? null,
    );
  }

  update(input: UpdateBaseTransactionInput): Promise<BaseTransaction> {
    const current = this.records.get(input.id);
    if (!current) return Promise.reject(new Error(`Base transaction not found: ${input.id}`));
    const updated: BaseTransaction = {
      ...current,
      ...input,
      updatedAt: new Date('2026-08-23T12:01:00.000Z'),
      ...(input.status === 'CONFIRMED'
        ? { confirmedAt: new Date('2026-08-23T12:01:00.000Z') }
        : {}),
    };
    this.records.set(input.id, updated);
    return Promise.resolve(updated);
  }
}
