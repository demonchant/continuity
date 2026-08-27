import { Router } from 'express';
import type { ApplicationConfig } from '../../config/index.js';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { createHealthController } from './health-controller.js';
import type { HealthService } from './health-service.js';
import type { ReadinessService } from './readiness-service.js';

export function createHealthRouter(service: HealthService, config: ApplicationConfig): Router {
  const router = Router();
  router.get('/', asyncHandler(createHealthController(service, config)));
  return router;
}

export function createReadinessRouter(
  service: ReadinessService,
  config: ApplicationConfig,
): Router {
  const router = Router();
  router.get(
    '/',
    asyncHandler(async (_request, response) => {
      const result = await service.check();
      response.status(result.status === 'ready' ? 200 : 503).json({
        service: config.service.name,
        version: config.service.version,
        ...result,
        timestamp: new Date().toISOString(),
      });
    }),
  );
  return router;
}
