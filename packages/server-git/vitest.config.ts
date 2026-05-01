import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks', // Use forks pool to preserve environment
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['tests/**', 'dist/**', 'src/embedded.ts', 'src/standalone.ts', '**/*.test.ts', '**/*.config.ts'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85
      }
    },
    testTimeout: 10000,
    hookTimeout: 10000
  }
});
