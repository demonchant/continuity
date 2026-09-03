import express from 'express';
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { AccessPrincipal } from '../../src/access/access.js';
import type { AccessService } from '../../src/access/access-service.js';
import { createPortalRouter } from '../../src/access/portal-routes.js';
import { createErrorHandler } from '../../src/api/middleware/error-handler.js';
import type { DashboardService } from '../../src/dashboard/dashboard-service.js';
import { MissionService } from '../../src/missions/mission-service.js';
import type { MissionWorker } from '../../src/runner/mission-worker.js';
import { InMemoryMissionRepository } from '../support/in-memory-mission-repository.js';

const logger = pino({ level: 'silent' });
const basePrincipal: AccessPrincipal = {
  userId: '00000000-0000-4000-8000-000000000201',
  email: 'judge@example.com',
  name: 'Judge',
  organizationId: '00000000-0000-4000-8000-000000000202',
  organizationName: 'Judge sandbox',
  organizationMode: 'JUDGE',
  role: 'JUDGE',
  spendingEnabled: false,
  maximumMissionBudget: '1',
  maximumAcpJobUsdc: '0',
  sessionId: 'session-judge',
};

function application(principal: AccessPrincipal) {
  const missions = new MissionService(new InMemoryMissionRepository());
  const access = { session: vi.fn().mockResolvedValue(principal) } as unknown as AccessService;
  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1/portal',
    createPortalRouter({
      access,
      missions,
      dashboard: {} as DashboardService,
      worker: { enqueue: vi.fn() } as unknown as MissionWorker,
    }),
  );
  app.use(createErrorHandler(logger));
  return { app, missions };
}

const missionBody = {
  objective: 'Analyze current crypto market news',
  budget: '0.50',
  constraints: { capabilities: ['analysis'] },
};

describe('customer and judge portal boundaries', () => {
  it('lets a judge create an isolated preview mission but never run or spend', async () => {
    const { app } = application(basePrincipal);
    const created = await request(app)
      .post('/api/v1/portal/missions')
      .set('cookie', 'continuity_session=judge-token')
      .send(missionBody)
      .expect(201);
    expect(created.body.data.mission.organizationId).toBe(basePrincipal.organizationId);
    await request(app)
      .post(`/api/v1/portal/missions/${created.body.data.mission.id}/run`)
      .set('cookie', 'continuity_session=judge-token')
      .expect(403);
    const overview = await request(app)
      .get('/api/v1/portal/overview')
      .set('cookie', 'continuity_session=judge-token')
      .expect(200);
    expect(overview.body.data.missions).toHaveLength(1);
  });

  it('enforces organization mission budgets before persistence', async () => {
    const principal = {
      ...basePrincipal,
      organizationMode: 'CUSTOMER' as const,
      role: 'OWNER' as const,
      maximumMissionBudget: '0.25',
    };
    const { app } = application(principal);
    await request(app)
      .post('/api/v1/portal/missions')
      .set('cookie', 'continuity_session=customer-token')
      .send(missionBody)
      .expect(422);
  });
});
