import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from '../../src/app.js';

const prisma = { $queryRaw: async () => [{ '?column?': 1 }] } as unknown as PrismaClient;
const app = createApp(prisma);

describe('HTTP foundation', () => {
  it('returns health', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body.service).toBe('continuity-api');
  });
  it('returns structured 404', async () => {
    const response = await request(app).get('/missing');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
  it('reports unavailable database health', async () => {
    const unavailable = {
      $queryRaw: async () => {
        throw new Error('offline');
      },
    } as unknown as PrismaClient;
    const response = await request(createApp(unavailable)).get('/api/v1/health');
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ status: 'degraded', database: 'unavailable' });
  });
});
