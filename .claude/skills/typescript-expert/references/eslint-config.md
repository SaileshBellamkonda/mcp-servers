# ESLint Flat Config with typescript-eslint

## Overview

- ESLint 9.x uses **flat config** (`eslint.config.*`) exclusively — `.eslintrc.*` is removed
- `typescript-eslint` v8.x works with flat config via the `tseslint` helper
- Config file precedence: `.js` > `.mjs` > `.cjs` > `.ts` > `.mts` > `.cts`
- Prefer `eslint.config.mjs` for ESM projects (avoids `jiti` dependency for `.ts` config)

---

## Installation

```bash
pnpm add -D eslint @eslint/js typescript typescript-eslint
```

For type-checked linting, no extra packages needed — `typescript-eslint` includes typed rules.

---

## Minimal Setup (No Type Checking)

```js
// eslint.config.mjs
// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  js.configs.recommended,
  tseslint.configs.strict,       // includes recommended
  tseslint.configs.stylistic,    // opinionated style rules (no formatting)
);
```

---

## Recommended Setup (With Type Checking)

Type-checked rules catch real bugs (floating promises, unsafe assignments, etc.) at the cost of running `tsc` during lint.

```js
// eslint.config.mjs
// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // Global ignores (no other keys = global scope)
  globalIgnores(['dist/', 'coverage/', 'node_modules/']),

  // JS recommended baseline
  js.configs.recommended,

  // TypeScript: strict + stylistic with type information
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  // Parser options for type-checked rules
  {
    languageOptions: {
      parserOptions: {
        projectService: true,               // recommended: auto-finds tsconfig per file
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Rule customizations
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
    },
  },

  // Disable type-checked rules for plain JS files
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
```

---

## Monorepo Setup

In a pnpm workspace, each package lints itself. The root `eslint.config.mjs` can be shared:

```js
// eslint.config.mjs (root, shared config pattern)
// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/dist/', '**/coverage/', '**/node_modules/']),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
```

Each package can extend the root config or have its own `eslint.config.mjs`.

---

## Config Tiers (choose one per project maturity)

| Tier | Without Type Info | With Type Info | When to Use |
|------|------------------|----------------|-------------|
| Standard | `recommended` + `stylistic` | `recommendedTypeChecked` + `stylisticTypeChecked` | Most projects |
| Strict | `strict` + `stylistic` | `strictTypeChecked` + `stylisticTypeChecked` | TypeScript-proficient teams |
| All | ❌ Don't use | ❌ Don't use | Never — rules conflict |

---

## `projectService` vs `project` (parserOptions)

| Option | Description | When to Use |
|--------|-------------|-------------|
| `projectService: true` | Auto-discovers tsconfig per file using TypeScript's Language Service | **Recommended** for most projects |
| `project: './tsconfig.json'` | Explicit single tsconfig path | Legacy; still works |
| `project: ['./packages/*/tsconfig.json']` | Glob of tsconfigs | Monorepos with explicit paths |

`projectService: true` is the modern recommended approach. It handles monorepos and composite projects automatically.

---

## package.json Scripts

```json
{
  "scripts": {
    "lint": "eslint .",
    "lint:fix": "eslint . --fix"
  }
}
```

Or with pnpm workspace root:
```json
{
  "scripts": {
    "lint": "pnpm -r exec eslint .",
    "lint:fix": "pnpm -r exec eslint . --fix"
  }
}
```

---

## Useful Rule Configurations

```js
{
  rules: {
    // Require explicit return types on exported functions
    '@typescript-eslint/explicit-module-boundary-types': 'error',

    // Enforce using type imports (works with verbatimModuleSyntax)
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
    ],

    // Side-effect-free type imports
    '@typescript-eslint/no-import-type-side-effects': 'error',

    // No floating promises — catches async bugs
    '@typescript-eslint/no-floating-promises': 'error',   // requires type info

    // Warn on any (not error, to allow gradual migration)
    '@typescript-eslint/no-explicit-any': 'warn',

    // Require await in async functions
    '@typescript-eslint/require-await': 'error',          // requires type info

    // Enforce consistent use of `interface` vs `type`
    '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
  }
}
```

---

## Formatting Note

typescript-eslint explicitly recommends **not** using ESLint for formatting. Use Prettier instead:

```bash
pnpm add -D prettier
```

```json
// .prettierrc
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

Add `format` script:
```json
"scripts": {
  "format": "prettier --write .",
  "format:check": "prettier --check ."
}
```

---

## Deprecations / Removed

| Removed | Use Instead |
|---------|------------|
| `.eslintrc.json` / `.eslintrc.js` / `.eslintrc.yml` | `eslint.config.mjs` (flat config) |
| `parser: "@typescript-eslint/parser"` at top level | Handled by `tseslint` helper automatically |
| `plugins: ["@typescript-eslint"]` (string) | `plugins: { "@typescript-eslint": tseslint.plugin }` |
| `extends: ["plugin:@typescript-eslint/recommended"]` | `tseslint.configs.recommended` in flat array |
| `parserOptions.project` (array glob) | `parserOptions.projectService: true` |
| `import` assertions (`assert { type }`) | `import` attributes (`with { type }`) — `nodenext` rejects `assert` |
