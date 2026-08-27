import { PrismaClient } from '@prisma/client';
import { createApp } from './app.js';
import { env } from './config/index.js';
import { logger } from './utils/logger.js';

const prisma = new PrismaClient();
const server = createApp(prisma).listen(env.PORT, () =>
  logger.info({ port: env.PORT }, 'Continuity API listening'),
);

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await prisma.$disconnect();
}

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
