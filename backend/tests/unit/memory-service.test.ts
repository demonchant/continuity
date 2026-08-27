import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { loadDecisionMemoryContext } from '../../src/memory/decision-memory-context.js';
import { DisabledMemoryProvider } from '../../src/memory/memory-provider.js';
import type { MemoryRecord } from '../../src/memory/memory-record.js';
import { MemoryService } from '../../src/memory/memory-service.js';
import { MockMemoryProvider } from '../support/mock-memory-provider.js';

const now = new Date('2026-08-20T12:00:00.000Z');

function input() {
  return {
    missionId: 'mission-1',
    mission: 'Verify cited market research',
    capability: 'fact-verification',
    agentId: 'agent-a',
    result: 'Three unsupported claims were returned',
    verification: { status: 'FAIL' as const, summary: 'Unsupported claims', verifierVersion: '1' },
    cost: { amount: '0.42', currency: 'USDC' },
    failureReason: 'Unsupported claims',
    decisionReason: 'Agent was cheapest eligible candidate',
    confidence: 0.9,
    recommendation: 'Avoid agent-a for fact-verification until new verified evidence exists',
  };
}

function quietLogger() {
  return pino({ level: 'silent' });
}

describe('MemoryService', () => {
  it('writes meaningful failure memory to the entity and journal boundaries', async () => {
    const provider = new MockMemoryProvider();
    const memory = new MemoryService(provider, quietLogger(), {
      now: () => now,
      id: () => 'record-1',
    });

    const record = await memory.recordFailure(input());

    expect(record).toMatchObject({
      schemaVersion: 1,
      id: 'continuity-record-1',
      category: 'failure',
      timestamp: now.toISOString(),
      success: false,
      failureReason: 'Unsupported claims',
      recommendation: expect.stringContaining('Avoid agent-a'),
    });
    expect(provider.records).toEqual([record]);
    expect(provider.events).toEqual([record]);
  });

  it('writes a durable checkpoint entity and the latest Sibyl state document', async () => {
    const provider = new MockMemoryProvider();
    const memory = new MemoryService(provider, quietLogger(), {
      now: () => now,
      id: () => 'checkpoint-1',
    });

    const checkpoint = await memory.recordCheckpoint({
      category: 'recovery_checkpoint',
      missionId: 'mission-1',
      mission: 'Verify cited market research',
      capability: 'fact-verification',
      state: 'VERIFYING',
      nextAction: 'reconcile-job-result',
      recommendation: 'Do not submit the job again',
    });

    expect(provider.records).toEqual([checkpoint]);
    expect(provider.events).toEqual([checkpoint]);
    expect(provider.checkpoints).toEqual([
      { record: checkpoint, state: 'VERIFYING', nextAction: 'reconcile-job-result' },
    ]);
  });

  it('builds scoped recall and exposes provider record identifiers', async () => {
    const provider = new MockMemoryProvider();
    const memory = new MemoryService(provider, quietLogger());
    const record: MemoryRecord = {
      schemaVersion: 1,
      id: 'continuity-prior-failure',
      category: 'failure',
      timestamp: now.toISOString(),
      missionId: 'old-mission',
      mission: 'Verify research',
      capability: 'fact-verification',
      agentId: 'agent-a',
      success: false,
      recommendation: 'Avoid agent-a for comparable work',
    };
    provider.searchResult = [
      { record, sibylRecordId: 'sibyl-entity-77', sibylTier: 'entity', relevance: 0.8 },
    ];

    const result = await memory.recall({
      mission: 'Verify cited market research',
      capabilities: ['fact-verification'],
      agentIds: ['agent-a', 'agent-b'],
      categories: ['failure', 'experience'],
    });

    expect(provider.searches[0]).toMatchObject({
      text: expect.stringContaining('fact-verification'),
      categories: ['failure', 'experience'],
    });
    expect(result.records[0]?.sibylRecordId).toBe('sibyl-entity-77');
  });

  it('logs write, read, and result metadata without logging memory bodies', async () => {
    let output = '';
    const stream = new Writable({
      write(
        chunk: Buffer | string,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
      ) {
        output += chunk.toString();
        callback();
      },
    });
    const provider = new MockMemoryProvider();
    const memory = new MemoryService(provider, pino({ level: 'info' }, stream), {
      now: () => now,
      id: () => 'safe-log',
    });

    await memory.recordFailure({ ...input(), result: 'SECRET_RESULT_BODY' });
    await memory.recall({ mission: 'Research', capabilities: ['verification'] });

    expect(output).toContain('memory.write');
    expect(output).toContain('memory.read');
    expect(output).toContain('memory.result');
    expect(output).not.toContain('SECRET_RESULT_BODY');
  });
});

describe('decision memory boundary and deletion test', () => {
  it('turns recalled Sibyl failures into cited decision guidance', async () => {
    const provider = new MockMemoryProvider();
    const record: MemoryRecord = {
      schemaVersion: 1,
      id: 'prior-failure',
      category: 'failure',
      timestamp: now.toISOString(),
      missionId: 'old-mission',
      mission: 'Verify research',
      capability: 'fact-verification',
      agentId: 'agent-a',
      success: false,
      recommendation: 'Avoid agent-a for comparable fact-verification work',
    };
    provider.searchResult = [{ record, sibylRecordId: 'sibyl-42', sibylTier: 'entity' }];

    const context = await loadDecisionMemoryContext(new MemoryService(provider, quietLogger()), {
      mission: 'Verify new research',
      capabilities: ['fact-verification'],
    });

    expect(context).toMatchObject({
      historicalExperience: 'available',
      citedSibylRecordIds: ['sibyl-42'],
      avoidAgentIds: ['agent-a'],
      recommendations: [expect.stringContaining('Avoid agent-a')],
    });
  });

  it('makes historical decision evidence explicitly unavailable when Sibyl is removed', async () => {
    const context = await loadDecisionMemoryContext(
      new MemoryService(new DisabledMemoryProvider(), quietLogger()),
      { mission: 'Verify new research', capabilities: ['fact-verification'] },
    );

    expect(context).toEqual({
      historicalExperience: 'unavailable',
      reason: 'MEMORY_DISABLED',
      evidence: [],
      citedSibylRecordIds: [],
      recommendations: [],
      avoidAgentIds: [],
    });
  });
});
