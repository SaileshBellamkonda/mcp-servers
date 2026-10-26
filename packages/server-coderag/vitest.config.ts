import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolve @mcp-servers/* workspace packages to their TypeScript source (no build needed).
  ssr: {
    resolve: {
      conditions: ['@mcp-servers/source'],
    },
  },
  test: {
    globals: false,
    environment: 'node',
    pool: 'forks',
    clearMocks: true,
    restoreMocks: true,
    exclude: ['**/.tmp-*/**', '**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/embedded.ts',
        'src/standalone.ts',
        '**/*.test.ts',
        '**/*.config.ts',
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85,
      },
    },
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
