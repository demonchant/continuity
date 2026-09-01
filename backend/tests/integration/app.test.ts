import express from 'express';
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../src/api/app.js';
import { createErrorHandler } from '../../src/api/middleware/error-handler.js';
import type { ApplicationConfig } from '../../src/config/index.js';
import { AppError } from '../../src/shared/errors/app-error.js';
import { asyncHandler } from '../../src/shared/http/async-handler.js';
import { validateBody } from '../../src/shared/http/validation.js';
import type { DatabaseHealthRepository } from '../../src/api/health/health-repository.js';
import { HealthService } from '../../src/api/health/health-service.js';
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

function testApp(database: DatabaseHealthRepository) {
  return createApp({
    config,
    logger,
    healthService: new HealthService(database),
    missionService: new MissionService(new InMemoryMissionRepository()),
  });
}

describe('GET /health', () => {
  it('confirms the application and database are healthy', async () => {
    const database = { check: vi.fn().mockResolvedValue(undefined) };
    const response = await request(testApp(database)).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      service: 'continuity-api',
      version: '0.1.0',
      status: 'ok',
      database: { status: 'connected' },
    });
    expect(response.body.timestamp).toEqual(expect.any(String));
    expect(response.body).not.toHaveProperty('database.url');
  });

  it('safely reports degraded database connectivity', async () => {
    const database = { check: vi.fn().mockRejectedValue(new Error('private connection error')) };
    const response = await request(testApp(database)).get('/health');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      status: 'degraded',
      database: { status: 'unavailable' },
    });
    expect(JSON.stringify(response.body)).not.toContain('private connection error');
  });
});

describe('CORS policy', () => {
  it('allows only configured browser origins and rejects other preflights', async () => {
    const database = { check: vi.fn().mockResolvedValue(undefined) };
    const app = createApp({
      config: {
        ...config,
        runtime: { ...config.runtime, corsAllowedOrigins: ['https://continuity.example'] },
      },
      logger,
      healthService: new HealthService(database),
      missionService: new MissionService(new InMemoryMissionRepository()),
    });

    const allowed = await request(app)
      .options('/api/v1/missions')
      .set('origin', 'https://continuity.example');
    expect(allowed.status).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://continuity.example');

    const denied = await request(app)
      .options('/api/v1/missions')
      .set('origin', 'https://untrusted.example');
    expect(denied.status).toBe(403);
    expect(denied.headers).not.toHaveProperty('access-control-allow-origin');
  });
});

describe('global request errors', () => {
  it('returns a structured 404 with a request ID', async () => {
    const database = { check: vi.fn().mockResolvedValue(undefined) };
    const response = await request(testApp(database)).get('/missing');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND', requestId: expect.any(String) },
    });
  });

  it('returns useful Zod validation errors', async () => {
    const app = express();
    app.use(express.json());
    app.post(
      '/validated',
      validateBody(z.object({ objective: z.string().trim().min(1) })),
      (_request, response) => response.sendStatus(204),
    );
    app.use(createErrorHandler(logger));

    const response = await request(app).post('/validated').send({ objective: '' });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
    });
  });

  it('rejects malformed JSON and oversized bodies without exposing parser details', async () => {
    const database = { check: vi.fn().mockResolvedValue(undefined) };
    const malformed = await request(testApp(database))
      .post('/api/v1/missions')
      .set('content-type', 'application/json')
      .send('{"objective":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toMatchObject({ code: 'MALFORMED_JSON' });

    const oversized = await request(testApp(database))
      .post('/api/v1/missions')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ objective: 'x'.repeat(1_100_000), budget: '1' }));
    expect(oversized.status).toBe(413);
    expect(oversized.body.error).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body exceeds the allowed size',
    });
  });

  it('forwards rejected async handlers to the global error handler', async () => {
    const app = express();
    app.get(
      '/async-error',
      asyncHandler(() =>
        Promise.reject(new AppError({ statusCode: 409, code: 'CONFLICT', message: 'Conflict' })),
      ),
    );
    app.use(createErrorHandler(logger));

    const response = await request(app).get('/async-error');
    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({ code: 'CONFLICT', message: 'Conflict' });
  });

  it('logs only a bounded diagnostic category for Virtuals discovery failures', async () => {
    const warn = vi.fn();
    const discoveryLogger = { ...logger, warn };
    const app = express();
    app.get('/discovery', () => {
      throw new AppError({
        statusCode: 502,
        code: 'VIRTUALS_DISCOVERY_FAILED',
        message: 'Virtuals ACP agent discovery failed',
        cause: Object.assign(
          new Error('browseAgents failed: 502 upstream-sensitive-status-text'),
          { code: 'ECONNRESET' },
        ),
      });
    });
    app.use(createErrorHandler(discoveryLogger));

    const response = await request(app).get('/discovery').set('x-request-id', 'discovery-test');
    expect(response.status).toBe(502);
    expect(JSON.stringify(response.body)).not.toContain('secret-value');
    expect(warn).toHaveBeenCalledWith(
      {
        event: 'virtuals.discovery.failed',
        requestId: undefined,
        failureClass: 'PROVIDER_UNAVAILABLE_OR_NETWORK_ERROR',
        failureStage: 'ACP_AGENT_SEARCH',
        rootErrorName: 'Error',
        rootErrorCode: 'ECONNRESET',
        upstreamStatus: 502,
      },
      'Virtuals discovery failed',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-value');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('upstream-sensitive-status-text');
  });

  it('does not expose unexpected internal errors', async () => {
    const app = express();
    app.get('/unexpected', () => {
      throw new Error('sensitive internals');
    });
    app.use(createErrorHandler(logger));

    const response = await request(app).get('/unexpected');
    expect(response.status).toBe(500);
    expect(response.body.error).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    });
    expect(JSON.stringify(response.body)).not.toContain('sensitive internals');
  });
});

describe('public deployment hardening', () => {
  it('protects mission operations with the central timing-safe bearer token', async () => {
    const operatorToken = 'continuity-operator-token-at-least-20-characters';
    const app = createApp({
      config: {
        ...config,
        security: {
          operatorToken,
          rateLimitWindowMs: 60_000,
          rateLimitMaxRequests: 20,
        },
      },
      logger,
      healthService: new HealthService({ check: () => Promise.resolve() }),
      missionService: new MissionService(new InMemoryMissionRepository()),
    });
    expect((await request(app).get('/api/v1/missions')).status).toBe(401);
    expect(
      (await request(app).get('/api/v1/missions').set('authorization', `Bearer ${operatorToken}`))
        .status,
    ).toBe(200);
  });

  it('rate limits API requests and emits a response request ID', async () => {
    const app = createApp({
      config: {
        ...config,
        security: { rateLimitWindowMs: 60_000, rateLimitMaxRequests: 1 },
      },
      logger,
      healthService: new HealthService({ check: () => Promise.resolve() }),
      missionService: new MissionService(new InMemoryMissionRepository()),
    });
    const first = await request(app).get('/api/v1/health');
    expect(first.status).toBe(200);
    expect(first.headers['x-request-id']).toEqual(expect.any(String));
    const second = await request(app).get('/api/v1/health');
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('RATE_LIMITED');
  });
});
