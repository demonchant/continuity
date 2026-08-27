import type { PrismaClient } from '@prisma/client';

export interface HealthRepository {
  checkDatabase(): Promise<boolean>;
}

export class PrismaHealthRepository implements HealthRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async checkDatabase(): Promise<boolean> {
    await this.prisma.$queryRaw`SELECT 1`;
    return true;
  }
}
