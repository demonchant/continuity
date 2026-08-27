import type { PrismaClient } from '@prisma/client';

export interface DatabaseHealthRepository {
  check(): Promise<void>;
}

export class PrismaDatabaseHealthRepository implements DatabaseHealthRepository {
  constructor(private readonly client: PrismaClient) {}

  async check(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }
}
