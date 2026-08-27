import type { RequestHandler } from 'express';
import type { HealthService } from '../services/health-service.js';

export function createHealthController(service: HealthService): RequestHandler {
  return async (_request, response, next) => {
    try {
      const health = await service.check();
      response.status(health.status === 'ok' ? 200 : 503).json({
        ...health,
        service: 'continuity-api',
        timestamp: new Date().toISOString(),
        version: '0.1.0',
      });
    } catch (error) {
      next(error);
    }
  };
}
