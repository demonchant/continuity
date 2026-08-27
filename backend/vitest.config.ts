import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    // Database suites share one disposable schema and own destructive cleanup.
    // File serialization prevents cleanup hooks from deleting another suite's rows.
    fileParallelism: false,
    include: ['tests/**/*.test.ts'],
  },
});
