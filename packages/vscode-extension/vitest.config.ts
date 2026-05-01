import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    // Only treat files in the `tests/` folder or files matching test filename patterns as test suites
    include: ['tests/**/*.ts', 'src/**/*.test.*', 'src/**/*.spec.*'],
    testTimeout: 60000,
    hookTimeout: 5000,
    alias: {
      vscode: path.resolve(__dirname, './__mocks__/vscode.ts'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'html', 'text'],
      include: ['src/**/*.ts'],
    },
  },
});
