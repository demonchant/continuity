import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { ReadinessService } from '../../src/api/health/readiness-service.js';
import { MemoryService } from '../../src/memory/memory-service.js';
import { MockMemoryProvider } from '../support/mock-memory-provider.js';

const logger = pino({ level: 'silent' });

describe('ReadinessService', () => {
  it('requires both PostgreSQL and Sibyl', async () => {
    const database = { check: vi.fn().mockResolvedValue(undefined) };
    const provider = new MockMemoryProvider();
    await expect(
      new ReadinessService(database, new MemoryService(provider, logger)).check(),
    ).resolves.toEqual({ status: 'ready', database: 'connected', sibyl: 'connected' });
    expect(provider.searches).toHaveLength(1);
  });

  it('fails readiness without exposing a dependency error', async () => {
    const database = { check: vi.fn().mockRejectedValue(new Error('secret database URL')) };
    const provider = new MockMemoryProvider();
    provider.search = vi.fn().mockRejectedValue(new Error('secret Sibyl path'));
    const result = await new ReadinessService(
      database,
      new MemoryService(provider, logger),
    ).check();
    expect(result).toEqual({
      status: 'not_ready',
      database: 'unavailable',
      sibyl: 'unavailable',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
