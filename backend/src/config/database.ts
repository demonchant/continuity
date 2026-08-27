import { PrismaClient } from '@prisma/client';

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
  });
}

export async function connectDatabase(client: PrismaClient): Promise<void> {
  await client.$connect();
}

export async function disconnectDatabase(client: PrismaClient): Promise<void> {
  await client.$disconnect();
}
