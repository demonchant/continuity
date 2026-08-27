import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      DATABASE_URL: 'postgresql://localhost/continuity_test',
    },
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
