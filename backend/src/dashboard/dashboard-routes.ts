import { fileURLToPath } from 'node:url';
import express, { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../shared/http/async-handler.js';
import { validateParams } from '../shared/http/validation.js';
import type { DashboardService } from './dashboard-service.js';
import { bearerAuthenticated } from '../shared/http/bearer-auth.js';

const missionIdSchema = z.object({ id: z.string().uuid() }).strict();
const publicDirectory = fileURLToPath(new URL('../../../public/continuity', import.meta.url));
const landingDirectory = fileURLToPath(new URL('../../../public/landing', import.meta.url));
const dashboardPages = [
  '/dashboard',
  '/dashboard/missions',
  '/dashboard/agents',
  '/dashboard/memory',
  '/dashboard/activity',
  '/dashboard/judge',
  '/dashboard/missions/:id',
];

export function createDashboardApiRouter(
  service: DashboardService,
  operatorToken?: string,
): Router {
  const router = Router();
  if (operatorToken) router.use(bearerAuthenticated(operatorToken, 'DASHBOARD_UNAUTHORIZED'));
  router.get(
    '/overview',
    asyncHandler(async (_request, response) => {
      response.json({ success: true, data: await service.overview() });
    }),
  );
  router.get(
    '/missions/:id',
    validateParams(missionIdSchema),
    asyncHandler(async (request, response) => {
      response.json({
        success: true,
        data: await service.missionDetail(String(request.params.id)),
      });
    }),
  );
  return router;
}

/** Public, read-only receipts for terminal demo missions; never exposes configuration or secrets. */
export function createJudgeApiRouter(service: DashboardService): Router {
  const router = Router();
  router.get(
    '/overview',
    asyncHandler(async (_request, response) => {
      response.json({ success: true, data: await service.judgeOverview() });
    }),
  );
  router.get(
    '/missions/:id',
    validateParams(missionIdSchema),
    asyncHandler(async (request, response) => {
      response.json({
        success: true,
        data: await service.judgeMissionDetail(String(request.params.id)),
      });
    }),
  );
  return router;
}

export function createDashboardUiRouter(): Router {
  const router = Router();
  router.use(
    '/continuity-site',
    express.static(landingDirectory, {
      index: false,
      etag: true,
      maxAge: '1h',
    }),
  );
  router.use(
    '/continuity-ui',
    express.static(publicDirectory, {
      index: false,
      etag: true,
      maxAge: '1h',
    }),
  );
  router.get(dashboardPages, (_request, response) => {
    response.sendFile('index.html', { root: publicDirectory });
  });
  router.get('/', (_request, response) => {
    response.sendFile('index.html', { root: landingDirectory });
  });
  return router;
}
