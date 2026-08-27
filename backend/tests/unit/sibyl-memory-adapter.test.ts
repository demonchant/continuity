import { describe, expect, it, vi } from 'vitest';
import { SibylMemoryAdapter } from '../../src/integrations/sibyl/sibyl-memory-adapter.js';
import type { SibylToolClient } from '../../src/integrations/sibyl/sibyl-tool-client.js';
import type { MemoryRecord } from '../../src/memory/memory-record.js';

const record: MemoryRecord = {
  schemaVersion: 1,
  id: 'continuity-1',
  category: 'failure',
  timestamp: '2026-08-20T12:00:00.000Z',
  missionId: 'mission-1',
  mission: 'Verify research',
  capability: 'fact-verification',
  agentId: 'agent-a',
  success: false,
  failureReason: 'Unsupported claims',
};

function result(structuredContent: Record<string, unknown>) {
  return { structuredContent, content: [] };
}

describe('SibylMemoryAdapter official MCP contract', () => {
  it('uses memory_remember then memory_recall to return the genuine entity id', async () => {
    const call = vi
      .fn<SibylToolClient['call']>()
      .mockResolvedValueOnce(result({ ok: true, category: 'continuity_failure', name: record.id }))
      .mockResolvedValueOnce(result({ ok: true, entity: { id: 'sibyl-entity-9', body: record } }));
    const adapter = new SibylMemoryAdapter({ call, close: vi.fn() });

    await expect(adapter.remember(record)).resolves.toBe('sibyl-entity-9');
    expect(call).toHaveBeenNthCalledWith(1, 'memory_remember', {
      category: 'continuity_failure',
      name: record.id,
      body: record,
    });
    expect(call).toHaveBeenNthCalledWith(2, 'memory_recall', {
      category: 'continuity_failure',
      name: record.id,
    });
  });

  it('uses memory_search and normalizes entity and journal hits', async () => {
    const call = vi
      .fn<SibylToolClient['call']>()
      .mockResolvedValueOnce(
        result({
          ok: true,
          results: [
            {
              key: record.id,
              category: 'continuity_failure',
              tier: 'entity',
              body: record,
              rank: -0.7,
            },
            { key: 'event-1', tier: 'journal', body: { acted: { body: record } } },
            { key: 'unrelated', tier: 'entity', body: { arbitrary: true } },
          ],
        }),
      )
      .mockResolvedValueOnce(result({ ok: true, entity: { id: 'entity-1', body: record } }));
    const adapter = new SibylMemoryAdapter({ call, close: vi.fn() });

    const memories = await adapter.search({
      text: 'continuity fact-verification',
      categories: ['failure'],
      limit: 10,
    });

    expect(call).toHaveBeenCalledWith('memory_search', {
      query: 'continuity fact-verification',
      limit: 10,
      tiers: 'entity,journal',
    });
    expect(call).toHaveBeenNthCalledWith(2, 'memory_recall', {
      category: 'continuity_failure',
      name: record.id,
    });
    expect(memories.map(({ sibylRecordId }) => sibylRecordId)).toEqual(['entity-1']);
  });

  it('exact-recalls current truncated search bodies before parsing them', async () => {
    const call = vi
      .fn<SibylToolClient['call']>()
      .mockResolvedValueOnce(
        result({
          ok: true,
          results: [
            {
              key: record.id,
              category: 'continuity_failure',
              tier: 'entity',
              body: '{"schemaVersion":1,"truncated":true',
              truncated: true,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(result({ ok: true, entity: { id: 'entity-live', body: record } }));
    const adapter = new SibylMemoryAdapter({ call, close: vi.fn() });

    await expect(
      adapter.search({ text: 'fact-verification', categories: ['failure'], limit: 10 }),
    ).resolves.toMatchObject([{ record, sibylRecordId: 'entity-live', sibylTier: 'entity' }]);
  });

  it('maps decision events and recovery checkpoints to supported tool names', async () => {
    const call = vi
      .fn<SibylToolClient['call']>()
      .mockResolvedValueOnce(result({ ok: true, event_id: 'event-2' }))
      .mockResolvedValueOnce(result({ ok: true, key: 'continuity_checkpoint_mission-1' }));
    const adapter = new SibylMemoryAdapter({ call, close: vi.fn() });

    await adapter.recordEvent(record);
    await adapter.setCheckpoint(record, 'VERIFYING', 'reconcile');

    expect(call.mock.calls[0]?.[0]).toBe('memory_record_event');
    expect(call.mock.calls[1]).toEqual([
      'memory_set_state',
      {
        key: 'continuity_checkpoint_mission-1',
        body: { record, state: 'VERIFYING', nextAction: 'reconcile' },
      },
    ]);
  });
});
