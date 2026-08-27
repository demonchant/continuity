import type { Server } from 'node:http';
import { createApp } from './api/app.js';
import { PrismaDatabaseHealthRepository } from './api/health/health-repository.js';
import { HealthService } from './api/health/health-service.js';
import { ReadinessService } from './api/health/readiness-service.js';
import { PrismaBetaSignupRepository } from './beta/prisma-beta-signup-repository.js';
import { connectDatabase, createPrismaClient, disconnectDatabase } from './config/database.js';
import { loadConfig } from './config/index.js';
import { createConfiguredMemoryProvider } from './config/memory-provider.js';
import { DashboardService } from './dashboard/dashboard-service.js';
import { EconomicActionService } from './economics/economic-action-service.js';
import { EconomicDecisionService } from './economics/economic-decision-service.js';
import { BasePaymentService } from './integrations/base/base-payment-service.js';
import type { BaseTransactionGateway } from './integrations/base/base-gateway.js';
import { PrismaBaseTransactionRepository } from './integrations/base/prisma-base-transaction-repository.js';
import { PrismaVirtualsJobRepository } from './integrations/virtuals/prisma-virtuals-job-repository.js';
import type { VirtualsAcpAdapter } from './integrations/virtuals/virtuals-acp-adapter.js';
import { VirtualsExecutionService } from './integrations/virtuals/virtuals-execution-service.js';
import { MemoryService } from './memory/memory-service.js';
import { MissionService } from './missions/mission-service.js';
import { PrismaMissionRepository } from './missions/prisma-mission-repository.js';
import { PrismaRecoveryRepository } from './recovery/prisma-recovery-repository.js';
import { RecoveryService } from './recovery/recovery-service.js';
import { MissionReconciliationCoordinator } from './recovery/mission-reconciliation-coordinator.js';
import { MissionRunner } from './runner/mission-runner.js';
import { MissionWorker } from './runner/mission-worker.js';
import { PrismaMissionWorkerRepository } from './runner/prisma-mission-worker-repository.js';
import { createLogger } from './shared/logging/logger.js';
import { VerificationService } from './verification/verification-service.js';

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const prisma = createPrismaClient(config.database.url);
  const memoryProvider = createConfiguredMemoryProvider(config.memory);
  const memoryService = new MemoryService(memoryProvider, logger);
  let virtualsAdapter: VirtualsAcpAdapter | undefined;
  let missionWorker: MissionWorker | undefined;
  let baseGateway: BaseTransactionGateway | undefined;

  try {
    await connectDatabase(prisma);
    logger.info('PostgreSQL connection established');
  } catch (error) {
    if (config.runtime.environment === 'production') throw error;
    logger.warn({ err: error }, 'PostgreSQL unavailable at startup; health will be degraded');
  }

  const databaseHealth = new PrismaDatabaseHealthRepository(prisma);
  const healthService = new HealthService(databaseHealth);
  const readinessService = new ReadinessService(databaseHealth, memoryService);
  if (config.runtime.environment === 'production') {
    const dependencyReadiness = await readinessService.check();
    if (dependencyReadiness.status !== 'ready') {
      throw new Error(
        `Required production dependencies are unavailable (database=${dependencyReadiness.database}, sibyl=${dependencyReadiness.sibyl})`,
      );
    }
    logger.info({ event: 'dependencies.ready' }, 'PostgreSQL and Sibyl readiness established');
  }
  const missionService = new MissionService(new PrismaMissionRepository(prisma));
  const recovery = new RecoveryService(new PrismaRecoveryRepository(prisma), memoryService, logger);
  const virtualsJobs = new PrismaVirtualsJobRepository(prisma);
  const baseTransactions = new PrismaBaseTransactionRepository(prisma);
  let virtuals: Parameters<typeof createApp>[0]['virtuals'];
  let virtualsExecution: VirtualsExecutionService | undefined;
  if (config.virtuals.enabled) {
    if (
      !config.virtuals.walletAddress ||
      !config.virtuals.walletId ||
      !config.virtuals.signerPrivateKey ||
      !config.virtuals.operatorToken
    ) {
      throw new Error('Validated Virtuals configuration is incomplete');
    }
    const { VirtualsAcpAdapter } = await import('./integrations/virtuals/virtuals-acp-adapter.js');
    virtualsAdapter = await VirtualsAcpAdapter.create({
      walletAddress: config.virtuals.walletAddress,
      walletId: config.virtuals.walletId,
      signerPrivateKey: config.virtuals.signerPrivateKey,
      chainId: config.virtuals.chainId,
      ...(config.virtuals.builderCode ? { builderCode: config.virtuals.builderCode } : {}),
    });
    virtualsExecution = new VirtualsExecutionService(
      virtualsAdapter,
      virtualsJobs,
      memoryService,
      recovery,
      new VerificationService(memoryService, logger),
      logger,
      {
        maxJobUsdc: config.virtuals.maxJobUsdc,
        pollIntervalMs: config.virtuals.pollIntervalMs,
        timeoutMs: config.virtuals.jobTimeoutMs,
      },
    );
    virtuals = {
      execution: virtualsExecution,
      jobs: virtualsJobs,
      operatorToken: config.virtuals.operatorToken,
    };
    logger.info(
      { event: 'virtuals.integration.enabled', chainId: config.virtuals.chainId },
      'Official Virtuals ACP execution integration enabled',
    );
  }
  let baseIntegration: Parameters<typeof createApp>[0]['base'];
  let basePayments: BasePaymentService | undefined;
  if (config.base.enabled) {
    if (!config.base.privateKey || !config.base.paymentRecipient || !config.base.operatorToken) {
      throw new Error('Validated Base configuration is incomplete');
    }
    const { BaseViemAdapter } = await import('./integrations/base/base-viem-adapter.js');
    const baseAdapter = await BaseViemAdapter.create({
      network: config.base.network,
      rpcUrl: config.base.rpcUrl,
      privateKey: config.base.privateKey,
      ...(config.base.rpcTimeoutMs ? { timeoutMs: config.base.rpcTimeoutMs } : {}),
      ...(config.base.rpcRetryCount === undefined ? {} : { retryCount: config.base.rpcRetryCount }),
    });
    baseGateway = baseAdapter;
    basePayments = new BasePaymentService(
      baseAdapter,
      baseTransactions,
      recovery,
      memoryService,
      logger,
      {
        recipient: config.base.paymentRecipient,
        maxPaymentAmount: config.base.maxPaymentAmount,
        confirmations: config.base.confirmations,
        asset: config.base.paymentAsset,
        ...(config.base.tokenAddress ? { tokenAddress: config.base.tokenAddress } : {}),
      },
    );
    baseIntegration = {
      payments: basePayments,
      transactions: baseTransactions,
      operatorToken: config.base.operatorToken,
    };
    logger.info(
      {
        event: 'base.integration.enabled',
        network: config.base.network,
        chainId: baseAdapter.chainId,
      },
      'Base onchain payment integration enabled',
    );
  }
  const economics =
    virtualsAdapter && config.virtuals.operatorToken
      ? {
          service: new EconomicActionService(
            virtualsAdapter,
            new EconomicDecisionService(memoryService, logger),
            basePayments,
            logger,
          ),
          operatorToken: config.virtuals.operatorToken,
        }
      : undefined;
  const runner =
    virtualsExecution && config.virtuals.operatorToken
      ? (() => {
          const missionRunner = new MissionRunner(
            missionService,
            virtualsExecution,
            basePayments,
            memoryService,
            recovery,
            logger,
            config.runner,
          );
          const coordinator = new MissionReconciliationCoordinator(
            recovery,
            virtualsAdapter!,
            virtualsJobs,
            baseTransactions,
            baseGateway,
          );
          missionWorker = new MissionWorker(
            missionService,
            missionRunner,
            new PrismaMissionWorkerRepository(prisma),
            logger,
            { reconcile: (mission) => coordinator.reconcile(mission) },
          );
          return { service: missionWorker, operatorToken: config.virtuals.operatorToken };
        })()
      : undefined;
  const app = createApp({
    config,
    logger,
    healthService,
    readinessService,
    missionService,
    betaSignups: new PrismaBetaSignupRepository(prisma),
    ...(virtuals ? { virtuals } : {}),
    ...(baseIntegration ? { base: baseIntegration } : {}),
    ...(economics ? { economics } : {}),
    ...(runner ? { runner } : {}),
    dashboard: new DashboardService(missionService, memoryService, virtualsJobs, baseTransactions),
  });
  if (missionWorker) await missionWorker.start();
  const server = app.listen(config.runtime.port, () => {
    logger.info({ port: config.runtime.port }, 'Continuity API listening');
  });
  server.headersTimeout = config.runtime.headersTimeoutMs ?? 15_000;
  server.requestTimeout = config.runtime.requestTimeoutMs ?? 30_000;
  server.keepAliveTimeout = config.runtime.keepAliveTimeoutMs ?? 5_000;
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown started');

    const forceShutdown = setTimeout(() => {
      logger.fatal('Graceful shutdown timed out');
      process.exitCode = 1;
      server.closeAllConnections();
    }, config.runtime.shutdownTimeoutMs);
    forceShutdown.unref();

    try {
      await closeServer(server);
      if (missionWorker) await missionWorker.stop();
      if (virtualsAdapter) await virtualsAdapter.close();
      await memoryService.close();
      await disconnectDatabase(prisma);
      logger.info('Graceful shutdown completed');
    } catch (error) {
      logger.error({ err: error }, 'Graceful shutdown failed');
      process.exitCode = 1;
    } finally {
      clearTimeout(forceShutdown);
    }
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  process.stderr.write(`Continuity API failed to start: ${message}\n`);
  process.exitCode = 1;
});
