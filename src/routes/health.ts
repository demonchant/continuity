import { Router } from 'express';
import { createHealthController } from '../controllers/health-controller.js';
import type { HealthService } from '../services/health-service.js';

export function healthRoutes(service: HealthService) {
  const router = Router();
  router.get('/health', createHealthController(service));
  return router;
}
