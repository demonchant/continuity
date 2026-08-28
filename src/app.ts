import express from 'express';
import type { Express, Request } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { PrismaClient } from '@prisma/client';
import { healthRoutes } from './routes/health.js';
import { PrismaHealthRepository } from './repositories/health-repository.js';
import { HealthService } from './services/health-service.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { logger } from './utils/logger.js';

export function createApp(prisma: PrismaClient): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger,
      genReqId: (request: Request) =>
        request.headers['x-request-id']?.toString() ?? crypto.randomUUID(),
    }),
  );
  const healthService = new HealthService(new PrismaHealthRepository(prisma));
  app.use('/api/v1', healthRoutes(healthService));
  app.get('/health', (_request, response) => response.redirect(307, '/api/v1/health'));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
