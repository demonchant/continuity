import type { RequestHandler } from 'express';
import type { ApplicationConfig } from '../../config/index.js';
import type { HealthService } from './health-service.js';

export function createHealthController(
  service: HealthService,
  config: ApplicationConfig,
): RequestHandler {
  return async (_request, response) => {
    const result = await service.check();

    response.status(result.status === 'ok' ? 200 : 503).json({
      service: config.service.name,
      version: config.service.version,
      status: result.status,
      database: result.database,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    });
  };
}
