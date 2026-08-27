import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaHealthRepository } from '../../src/repositories/health-repository.js';

describe('PrismaHealthRepository', () => {
  it('queries the database', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ value: 1 }]);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaClient;
    await expect(new PrismaHealthRepository(prisma).checkDatabase()).resolves.toBe(true);
    expect(queryRaw).toHaveBeenCalledOnce();
  });
});
