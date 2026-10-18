import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.e2e.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    environment: 'node',
  },
});
