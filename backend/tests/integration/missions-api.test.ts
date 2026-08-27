import pino from 'pino';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/api/app.js';
import type { DatabaseHealthRepository } from '../../src/api/health/health-repository.js';
import { HealthService } from '../../src/api/health/health-service.js';
import type { ApplicationConfig } from '../../src/config/index.js';
import { MissionService } from '../../src/missions/mission-service.js';
import { InMemoryMissionRepository } from '../support/in-memory-mission-repository.js';

const config: ApplicationConfig = {
  service: { name: 'continuity-api', version: '0.1.0' },
  runtime: {
    environment: 'test',
    port: 3000,
    logLevel: 'silent',
    shutdownTimeoutMs: 5000,
  },
  database: { url: 'postgresql://user:password@localhost:5432/test' },
  memory: { enabled: true, command: 'sibyl-memory-mcp' },
  virtuals: {
    enabled: false,
    chainId: 8453,
    maxJobUsdc: 1,
    pollIntervalMs: 5000,
    jobTimeoutMs: 900000,
  },
  base: {
    enabled: false,
    network: 'base-sepolia',
    rpcUrl: 'https://sepolia.base.org',
    paymentAsset: 'ETH',
    maxPaymentAmount: '0.001',
    confirmations: 1,
  },
  runner: { maximumRetries: 2, timeoutMs: 900000, failureThreshold: 3, candidateLimit: 10 },
};

const logger = pino({ level: 'silent' });
const healthyDatabase: DatabaseHealthRepository = { check: () => Promise.resolve() };

describe('mission API', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp({
      config,
      logger,
      healthService: new HealthService(healthyDatabase),
      missionService: new MissionService(new InMemoryMissionRepository()),
    });
  });

  it('creates and retrieves a validated mission', async () => {
    const created = await request(app)
      .post('/missions')
      .send({
        objective: 'Research a Base project and cite every material claim',
        constraints: { requiredSources: 3, output: { format: 'json' } },
        budget: '2.50000000',
      });

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      objective: 'Research a Base project and cite every material claim',
      constraints: { requiredSources: 3, output: { format: 'json' } },
      budget: '2.50000000',
      status: 'CREATED',
      currentStep: 'created',
    });

    const retrieved = await request(app).get(`/missions/${created.body.data.id}`);
    expect(retrieved.status).toBe(200);
    expect(retrieved.body.data).toEqual(created.body.data);

    const listed = await request(app).get('/missions');
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].id).toBe(created.body.data.id);
  });

  it('cancels a nonterminal mission', async () => {
    const created = await request(app)
      .post('/missions')
      .send({ objective: 'Summarize the report', constraints: {}, budget: 0 });

    const cancelled = await request(app).post(`/missions/${created.body.data.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({
      status: 'CANCELLED',
      currentStep: 'cancelled',
    });
  });

  it('fails repeated cancellation safely', async () => {
    const created = await request(app)
      .post('/missions')
      .send({ objective: 'Summarize the report', budget: 0 });
    await request(app).post(`/missions/${created.body.data.id}/cancel`);

    const response = await request(app).post(`/missions/${created.body.data.id}/cancel`);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_MISSION_TRANSITION');
  });

  it.each([
    [{ objective: '', constraints: {}, budget: 1 }],
    [{ objective: 'Valid objective', constraints: {}, budget: -1 }],
    [{ objective: 'Valid objective', constraints: {}, budget: '1.000000000' }],
    [{ objective: 'Valid objective', constraints: {}, budget: 1, status: 'COMPLETED' }],
    [{ objective: 'Missing budget', constraints: {} }],
  ])('rejects malformed creation payload %j', async (payload) => {
    const response = await request(app).post('/missions').send(payload);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed mission identifiers', async () => {
    const response = await request(app).get('/missions/not-a-uuid');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns a safe not-found response', async () => {
    const response = await request(app).get('/missions/00000000-0000-4000-8000-000000000000');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('MISSION_NOT_FOUND');
  });
});
