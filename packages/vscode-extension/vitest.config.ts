import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      vscode: path.resolve(import.meta.dirname, './__mocks__/vscode.ts'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    pool: 'forks',
    clearMocks: true,
    restoreMocks: true,
    include: ['tests/**/*.ts', 'src/**/*.test.*', 'src/**/*.spec.*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/extension.ts', '**/*.test.ts', '**/*.config.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
