import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('PostgreSQL connectivity', () => {
  const client = databaseUrl
    ? new PrismaClient({
        datasources: {
          db: { url: databaseUrl },
        },
      })
    : undefined;

  afterAll(async () => {
    await client?.$disconnect();
  });

  it('executes a basic query through Prisma', async () => {
    if (!client) throw new Error('TEST_DATABASE_URL is required for this test');
    const rows = await client.$queryRaw<Array<{ value: number }>>`SELECT 1 AS value`;
    expect(rows[0]?.value).toBe(1);
  });
});
