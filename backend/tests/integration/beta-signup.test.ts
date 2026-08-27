import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/api/app.js';
import { HealthService } from '../../src/api/health/health-service.js';
import type {
  BetaSignupInput,
  BetaSignupRecord,
  BetaSignupRepository,
} from '../../src/beta/beta-signup.js';
import type { ApplicationConfig } from '../../src/config/index.js';
import { DashboardService } from '../../src/dashboard/dashboard-service.js';
import { MemoryService } from '../../src/memory/memory-service.js';
import { MissionService } from '../../src/missions/mission-service.js';
import { InMemoryMissionRepository } from '../support/in-memory-mission-repository.js';
import { MockMemoryProvider } from '../support/mock-memory-provider.js';

const config: ApplicationConfig = {
  service: { name: 'continuity-api', version: '0.1.0' },
  runtime: { environment: 'test', port: 3000, logLevel: 'silent', shutdownTimeoutMs: 5000 },
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
    paymentAsset: 'USDC',
    tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    maxPaymentAmount: '1.00',
    confirmations: 1,
  },
  runner: { maximumRetries: 2, timeoutMs: 900000, failureThreshold: 3, candidateLimit: 10 },
};

class InMemoryBetaSignupRepository implements BetaSignupRepository {
  readonly records = new Map<string, BetaSignupRecord>();

  upsert(input: BetaSignupInput): Promise<BetaSignupRecord> {
    const existing = this.records.get(input.email);
    const now = new Date();
    const record: BetaSignupRecord = {
      ...input,
      id: existing?.id ?? crypto.randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.records.set(input.email, record);
    return Promise.resolve(record);
  }
}

function application(signups: BetaSignupRepository) {
  const logger = pino({ level: 'silent' });
  const missions = new MissionService(new InMemoryMissionRepository());
  return createApp({
    config,
    logger,
    healthService: new HealthService({ check: () => Promise.resolve() }),
    missionService: missions,
    betaSignups: signups,
    dashboard: new DashboardService(missions, new MemoryService(new MockMemoryProvider(), logger)),
  });
}

describe('public landing page and private beta signup', () => {
  it('serves the landing page and its static client', async () => {
    const app = application(new InMemoryBetaSignupRepository());

    const page = await request(app).get('/');
    expect(page.status).toBe(200);
    expect(page.text).toContain(
      'Continuity remembers what worked, what failed, and what to do next.',
    );
    expect(page.text).toContain('Product flow illustration — not user data or a fabricated run.');
    expect((await request(app).get('/continuity-site/app.js')).status).toBe(200);
  });

  it('records one consented request per normalized email without exposing a public list', async () => {
    const signups = new InMemoryBetaSignupRepository();
    const app = application(signups);
    const payload = {
      email: 'Builder@Example.com',
      role: 'AGENT_DEVELOPER',
      workflow: 'Failed verification is buried in traces.',
      consentToContact: true,
      publicAttributionConsent: false,
    };

    expect((await request(app).post('/api/v1/beta-signups').send(payload)).status).toBe(202);
    expect((await request(app).post('/api/v1/beta-signups').send(payload)).status).toBe(202);
    expect(signups.records.size).toBe(1);
    expect(signups.records.get('builder@example.com')).toMatchObject({
      email: 'builder@example.com',
      consentToContact: true,
      publicAttributionConsent: false,
    });
    expect((await request(app).get('/api/v1/beta-signups')).status).toBe(404);
  });

  it('rejects missing consent and attribution permission without a name', async () => {
    const app = application(new InMemoryBetaSignupRepository());
    const base = {
      email: 'builder@example.com',
      role: 'MULTI_AGENT_TEAM',
      publicAttributionConsent: false,
    };

    expect(
      (
        await request(app)
          .post('/api/v1/beta-signups')
          .send({ ...base, consentToContact: false })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/v1/beta-signups')
          .send({ ...base, consentToContact: true, publicAttributionConsent: true })
      ).status,
    ).toBe(400);
  });
});
