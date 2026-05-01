import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    alias: {
      vscode: path.resolve(__dirname, './__mocks__/vscode.ts'),
    },
  },
});
