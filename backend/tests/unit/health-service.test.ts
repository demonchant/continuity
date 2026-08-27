import { describe, expect, it, vi } from 'vitest';
import type { DatabaseHealthRepository } from '../../src/api/health/health-repository.js';
import { HealthService } from '../../src/api/health/health-service.js';

describe('HealthService', () => {
  it('reports a connected database', async () => {
    const database: DatabaseHealthRepository = { check: vi.fn().mockResolvedValue(undefined) };

    await expect(new HealthService(database).check()).resolves.toEqual({
      status: 'ok',
      database: { status: 'connected' },
    });
  });

  it('reports database failure without exposing the underlying error', async () => {
    const database: DatabaseHealthRepository = {
      check: vi.fn().mockRejectedValue(new Error('secret connection detail')),
    };

    await expect(new HealthService(database).check()).resolves.toEqual({
      status: 'degraded',
      database: { status: 'unavailable' },
    });
  });
});
