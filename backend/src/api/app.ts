import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { OperatorApprovalService } from '../approvals/operator-approval-service.js';
import { pinoHttp } from 'pino-http';
import type { ApplicationConfig } from '../config/index.js';
import {
  createDashboardApiRouter,
  createDashboardUiRouter,
  createJudgeApiRouter,
} from '../dashboard/dashboard-routes.js';
import type { DashboardService } from '../dashboard/dashboard-service.js';
import { createBetaSignupRouter } from '../beta/beta-signup-routes.js';
import type { BetaSignupRepository } from '../beta/beta-signup.js';
import { createMissionRouter } from '../missions/mission-routes.js';
import type { MissionService } from '../missions/mission-service.js';
import {
  createEconomicDashboardRouter,
  createEconomicRouter,
} from '../economics/economic-routes.js';
import type { EconomicActionService } from '../economics/economic-action-service.js';
import { createBaseRouter } from '../integrations/base/base-routes.js';
import type { BasePaymentService } from '../integrations/base/base-payment-service.js';
import type { BaseTransactionRepository } from '../integrations/base/base-transaction-repository.js';
import { createVirtualsRouter } from '../integrations/virtuals/virtuals-routes.js';
import type { VirtualsExecutionService } from '../integrations/virtuals/virtuals-execution-service.js';
import type { VirtualsJobRepository } from '../integrations/virtuals/virtuals-job-repository.js';
import { createMissionRunnerRouter } from '../runner/mission-runner-routes.js';
import type { MissionWorker } from '../runner/mission-worker.js';
import type { MissionPlanCaps } from '../runner/mission-plan.js';
import { createHealthRouter } from './health/health-routes.js';
import { createReadinessRouter } from './health/health-routes.js';
import type { HealthService } from './health/health-service.js';
import type { ReadinessService } from './health/readiness-service.js';
import { createErrorHandler, createNotFoundHandler } from './middleware/error-handler.js';
import { fixedWindowRateLimit } from './middleware/rate-limit.js';
import {
  createAccessAdminRouter,
  createAccessRouter,
  createAccessUiRouter,
} from '../access/access-routes.js';
import type { AccessService } from '../access/access-service.js';
import type { AccessNotificationService } from '../access/access-notifications.js';
import { createPortalRouter } from '../access/portal-routes.js';

export interface ApplicationDependencies {
  readonly config: ApplicationConfig;
  readonly logger: Logger;
  readonly healthService: HealthService;
  readonly readinessService?: ReadinessService;
  readonly missionService: MissionService;
  readonly betaSignups?: BetaSignupRepository;
  readonly access?: {
    readonly service: AccessService;
    readonly notifications: AccessNotificationService;
  };
  readonly virtuals?: {
    readonly execution: VirtualsExecutionService;
    readonly jobs: VirtualsJobRepository;
    readonly operatorToken: string;
  };
  readonly base?: {
    readonly payments: BasePaymentService;
    readonly transactions: BaseTransactionRepository;
    readonly operatorToken: string;
  };
  readonly economics?: {
    readonly service: EconomicActionService;
    readonly operatorToken: string;
  };
  readonly runner?: {
    readonly service: MissionWorker;
    readonly approvals: OperatorApprovalService;
    readonly virtuals: VirtualsExecutionService;
    readonly jobs: VirtualsJobRepository;
    readonly basePayments?: BasePaymentService;
    readonly runnerCaps: MissionPlanCaps;
    readonly operatorToken: string;
  };
  readonly dashboard?: DashboardService;
}

function requestId(request: Request): string {
  const candidate = request.header('x-request-id');
  return candidate && /^[a-zA-Z0-9._:-]{1,128}$/.test(candidate) ? candidate : randomUUID();
}

function configureCors(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);
  return (request: Request, response: Response, next: NextFunction): void => {
    const origin = request.header('origin');
    if (origin && allowed.has(origin)) {
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('access-control-allow-methods', 'GET,HEAD,POST,OPTIONS');
      response.setHeader('access-control-allow-headers', 'authorization,content-type,x-request-id');
      response.setHeader('vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      response.sendStatus(origin && allowed.has(origin) ? 204 : 403);
      return;
    }
    next();
  };
}

export function createApp(dependencies: ApplicationDependencies) {
  const app = express();

  app.disable('x-powered-by');
  if (dependencies.config.runtime.environment === 'production') app.set('trust proxy', 1);
  app.use(helmet());
  app.use(configureCors(dependencies.config.runtime.corsAllowedOrigins ?? []));
  app.use(express.json({ limit: '256kb', strict: true }));
  app.use(
    '/api',
    fixedWindowRateLimit({
      windowMs: dependencies.config.security?.rateLimitWindowMs ?? 60_000,
      maximum: dependencies.config.security?.rateLimitMaxRequests ?? 120,
    }),
  );
  app.use('/api', (_request, response, next) => {
    response.setHeader('cache-control', 'no-store');
    next();
  });
  app.use(
    pinoHttp({
      logger: dependencies.logger,
      genReqId: requestId,
    }),
  );
  app.use((request, response, next) => {
    const responseRequestId =
      typeof request.id === 'string' || typeof request.id === 'number'
        ? `${request.id}`
        : randomUUID();
    response.setHeader('x-request-id', responseRequestId);
    next();
  });

  const healthRouter = createHealthRouter(dependencies.healthService, dependencies.config);
  app.use('/health', healthRouter);
  app.use('/api/v1/health', healthRouter);
  if (dependencies.readinessService) {
    app.use(
      '/api/v1/readiness',
      createReadinessRouter(dependencies.readinessService, dependencies.config),
    );
  }

  if (dependencies.betaSignups) {
    app.use(
      '/api/v1/beta-signups',
      createBetaSignupRouter(dependencies.betaSignups, dependencies.access?.notifications),
    );
  }
  if (dependencies.access) {
    app.use(
      '/api/v1/access',
      createAccessRouter(
        dependencies.access.service,
        dependencies.config.runtime.environment === 'production',
      ),
    );
    if (dependencies.config.security?.operatorToken) {
      app.use(
        '/api/v1/access-admin',
        createAccessAdminRouter(
          dependencies.access.service,
          dependencies.config.security.operatorToken,
        ),
      );
    }
  }

  const missionRouter = createMissionRouter(
    dependencies.missionService,
    dependencies.config.security?.operatorToken,
  );
  app.use('/missions', missionRouter);
  app.use('/api/v1/missions', missionRouter);
  if (dependencies.runner) {
    app.use(
      '/api/v1/missions',
      createMissionRunnerRouter({
        worker: dependencies.runner.service,
        missions: dependencies.missionService,
        jobs: dependencies.runner.jobs,
        virtuals: dependencies.runner.virtuals,
        approvals: dependencies.runner.approvals,
        ...(dependencies.runner.basePayments
          ? { basePayments: dependencies.runner.basePayments }
          : {}),
        runnerCaps: dependencies.runner.runnerCaps,
        operatorToken: dependencies.runner.operatorToken,
      }),
    );
  }

  if (dependencies.virtuals) {
    app.use(
      '/api/v1/virtuals',
      createVirtualsRouter(
        dependencies.virtuals.execution,
        dependencies.virtuals.jobs,
        dependencies.missionService,
        dependencies.virtuals.operatorToken,
      ),
    );
  }
  if (dependencies.base) {
    app.use(
      '/api/v1/base',
      createBaseRouter(
        dependencies.base.payments,
        dependencies.base.transactions,
        dependencies.missionService,
        dependencies.base.operatorToken,
      ),
    );
  }
  if (dependencies.economics) {
    app.use(
      '/api/v1/economic-decisions',
      createEconomicRouter(
        dependencies.economics.service,
        dependencies.missionService,
        dependencies.economics.operatorToken,
      ),
    );
    app.use('/', createEconomicDashboardRouter());
  }
  if (dependencies.dashboard) {
    app.use('/api/v1/judge', createJudgeApiRouter(dependencies.dashboard));
    app.use(
      '/api/v1/dashboard',
      createDashboardApiRouter(dependencies.dashboard, dependencies.config.security?.operatorToken),
    );
    app.use(createDashboardUiRouter());
  }
  if (dependencies.access && dependencies.dashboard) {
    app.use(
      '/api/v1/portal',
      createPortalRouter({
        access: dependencies.access.service,
        missions: dependencies.missionService,
        dashboard: dependencies.dashboard,
        ...(dependencies.virtuals
          ? { virtuals: dependencies.virtuals.execution, jobs: dependencies.virtuals.jobs }
          : {}),
        ...(dependencies.runner
          ? {
              worker: dependencies.runner.service,
              approvals: dependencies.runner.approvals,
              runnerCaps: dependencies.runner.runnerCaps,
              ...(dependencies.runner.basePayments
                ? { basePayments: dependencies.runner.basePayments }
                : {}),
            }
          : {}),
      }),
    );
    app.use(createAccessUiRouter());
  }

  app.use(createNotFoundHandler());
  app.use(createErrorHandler(dependencies.logger));

  return app;
}
