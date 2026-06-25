// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const SOURCE_RULES = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/require-await': 'error',
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
};

export default defineConfig(
  globalIgnores([
    '**/dist/**',
    '**/coverage/**',
    '**/node_modules/**',
    '**/*.js',
    '**/*.mjs',
    '**/*.cjs',
    '**/*.d.ts',
  ]),

  js.configs.recommended,
  tseslint.configs.recommended,

  // ── server-git (ESM, nodenext) ──────────────────────────────────────────
  {
    files: ['packages/server-git/src/**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: SOURCE_RULES,
  },

  // ── server-coderag (ESM, nodenext) ─────────────────────────────────────
  {
    files: ['packages/server-coderag/src/**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: SOURCE_RULES,
  },

  // ── vscode-extension (CJS, commonjs) ───────────────────────────────────
  {
    files: ['packages/vscode-extension/src/**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: SOURCE_RULES,
  },

  // ── Test files and mocks — disable type-checked rules ──────────────────
  {
    files: ['**/tests/**/*.ts', '**/*.test.ts', '**/__mocks__/**/*.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
