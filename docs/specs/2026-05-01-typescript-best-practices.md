# TypeScript Best-Practices Remediation

**Date:** 2026-05-01  
**Status:** Draft  
**Scope:** Monorepo root + `packages/server-git` + `packages/vscode-extension`

---

## 1. Problem Statement

An audit of the repository against the TypeScript Expert skill (current as of May 2026) reveals gaps in dependency versions, missing tooling (ESLint), stale tsconfig options, weak Vitest configuration, and several code-quality / OWASP-relevant issues. This spec describes the remediation work needed to bring all packages up to current best practices.

---

## 2. Goals

- Set **Node.js 22** as the minimum supported version everywhere.
- Align all dependency versions with May 2026 stable releases.
- Centralise all shared dependency versions via **pnpm catalog** so no version is duplicated across packages.
- Add a **root-level `tsconfig.base.json`** that both packages extend; per-package configs only override what differs.
- Add a **single root-level `eslint.config.mjs`** covering the entire monorepo; no per-package ESLint configs needed.
- Harden `tsconfig.json` files in both packages with additional strictness options.
- Fix code-quality issues (no `any`, `node:` prefixes, path handling).
- Fix Vitest configuration deficiencies.
- Add missing root workspace scripts and configuration.

## 3. Non-Goals

- Rewriting application logic beyond the minimum needed to satisfy the type changes.
- Migrating `vscode-extension` to ESM (VS Code extension host requires CJS; this is intentional).
- Adding new MCP tools or features.

---

## 4. Detailed Findings & Required Changes

### 4.1 Dependency Versions

Both packages use significantly outdated toolchain packages.

| Package | Current | Target | Where installed |
|---|---|---|---|
| `typescript` | `^5.3.0` | `^5.8.0` | per-package (via catalog) |
| `vitest` | `^1.2.0` | `^4.0.0` | per-package (via catalog) |
| `@vitest/coverage-v8` | `^1.2.0` | `^4.0.0` | per-package (via catalog) |
| `@types/node` | `^20.11.0` | `^22.0.0` | per-package (via catalog) |
| `@tsconfig/node22` | absent | `^22.0.0` | per-package (via catalog) |
| `eslint` | absent | `^9.0.0` | **root only** |
| `@eslint/js` | absent | `^9.0.0` | **root only** |
| `typescript-eslint` | absent | `^8.0.0` | **root only** |

> **Why it matters:** Vitest 1.x → 4.x has breaking API changes. Node 20 types used against a Node 22 runtime cause false-positive type errors. TypeScript 5.8 adds `erasableSyntaxOnly` which is required for native type-stripping support. ESLint is installed only at the root because it is run exclusively from the root config — packages do not need it in their own `devDependencies`.

#### Action Items

- [ ] Upgrade `typescript`, `vitest`, `@vitest/coverage-v8`, `@types/node` in both package `package.json` files to use `catalog:` protocol after catalog is defined.
- [ ] Add `@tsconfig/node22` to `server-git` devDependencies using `catalog:`.
- [ ] Add `eslint`, `@eslint/js`, `typescript-eslint` to root `package.json` devDependencies only.

---

### 4.2 pnpm Workspace — Catalog & Root Config

**Current state:**
- `pnpm-workspace.yaml` has only `packages:` — no catalog.
- Root `package.json` has no `private`, no `type`, no `engines`, no recursive scripts.
- No `.npmrc`.

**Required changes:**

#### `pnpm-workspace.yaml` — add catalog

All shared toolchain versions are declared once in the catalog. Packages reference them as `catalog:` — the version is resolved at install time from this single source of truth.

```yaml
packages:
  - 'packages/*'

catalog:
  typescript: ^5.8.0
  '@tsconfig/node22': ^22.0.0
  '@types/node': ^22.0.0
  vitest: ^4.0.0
  '@vitest/coverage-v8': ^4.0.0
  # ESLint — root-only, but declared here so the root package.json uses catalog: too
  eslint: ^9.0.0
  '@eslint/js': ^9.0.0
  typescript-eslint: ^8.0.0
```

> **Catalog answers Q2**: Yes — pnpm catalog is the idiomatic mechanism for centralising package versions across a monorepo. No version range appears in more than one file. Running `pnpx codemod pnpm/catalog` automates migration of existing `package.json` files.

#### Root `package.json` — add missing fields

```jsonc
{
  "name": "mcp-servers",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.33.0",
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=10.0.0"
  },
  "scripts": {
    "build":     "pnpm -r run build",
    "typecheck": "pnpm -r run typecheck",
    "lint":      "eslint .",
    "lint:fix":  "eslint . --fix",
    "test":      "pnpm -r run test",
    "clean":     "pnpm -r run clean"
  },
  "devDependencies": {
    "eslint":             "catalog:",
    "@eslint/js":         "catalog:",
    "typescript-eslint":  "catalog:"
  }
}
```

Key points:
- `private: true` prevents accidental root publish.
- `type: module` ensures root `.js` files are ESM.
- `engines.node: ">=22.0.0"` enforces Node 22 minimum at the root.
- `lint` / `lint:fix` run from the root using the single root ESLint config — packages do **not** need their own lint scripts.
- ESLint packages are in root `devDependencies` only; they are not needed per-package.

#### `.npmrc` — add workspace config

```ini
# .npmrc
link-workspace-packages=true
prefer-workspace-packages=true
shamefully-hoist=false
```

---

### 4.3 ESLint — Single Root Config

No ESLint exists in the repository. A **single `eslint.config.mjs` at the repo root** covers the entire monorepo. Package-specific differences (e.g., the vscode-extension uses a different tsconfig) are handled with `files:` patterns inside the same config array.

> **Why root-only?** ESLint 9 flat config is array-based. A root config with `files:` overrides is more maintainable than N per-package configs and avoids duplicating rule sets. ESLint is installed once at root — `pnpm run lint` from root covers all packages.

#### Action Items

- [ ] Create `eslint.config.mjs` at repo root (template below).
- [ ] Add `"lint": "eslint ."` and `"lint:fix": "eslint . --fix"` to root `package.json` scripts (already shown in §4.2).
- [ ] Do **not** create per-package ESLint config files.
- [ ] Do **not** add ESLint packages to per-package `devDependencies`.
- [ ] Rename `"lint": "tsc --noEmit"` to `"typecheck": "tsc --noEmit"` in both package `package.json` scripts.

**`eslint.config.mjs` (repo root):**

```js
// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // Global ignores — applied to all configs below
  globalIgnores([
    '**/dist/**',
    '**/coverage/**',
    '**/node_modules/**',
    '**/*.js',          // compiled output
    '**/*.d.ts',
  ]),

  // JS recommended baseline
  js.configs.recommended,

  // TypeScript strict + stylistic with type information (both packages)
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  // ── server-git (ESM, nodenext) ──────────────────────────────────────────
  {
    files: ['packages/server-git/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'error',
    },
  },

  // ── vscode-extension (CJS, commonjs) ────────────────────────────────────
  {
    files: ['packages/vscode-extension/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'error',
    },
  },

  // ── Test files — relax some rules ───────────────────────────────────────
  {
    files: ['**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
```

> `projectService: true` automatically locates the nearest `tsconfig.json` for each source file, so the ESM `nodenext` config is used for `server-git` files and the CJS `commonjs` config is used for `vscode-extension` files — no manual `project:` path needed.

---

### 4.4 TypeScript Configuration — Root Base + Per-Package Overrides

A single **`tsconfig.base.json`** at the repo root defines every strictness option and the shared compiler settings. Each package's `tsconfig.json` extends it and overrides only what differs for that package (module format, paths, package-specific flags). This eliminates duplication and ensures all packages share the same strictness baseline.

> The root `tsconfig.json` remains the project-references file used by editors and `tsc --build`. It does **not** extend `tsconfig.base.json` — it only lists package references.

#### 4.4.1 New file: `tsconfig.base.json` (repo root)

```jsonc
// tsconfig.base.json — shared base for all packages; do not use directly
{
  "extends": "@tsconfig/node22/tsconfig.json",
  "compilerOptions": {
    // Additional strictness beyond @tsconfig/node22 baseline
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,

    // Replaces deprecated importsNotUsedAsValues + preserveValueImports
    "verbatimModuleSyntax": true,

    // Emit — overridden per-package
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true
  }
}
```

> `@tsconfig/node22` provides: `strict: true`, `target: "ES2023"`, `skipLibCheck: true`, `esModuleInterop: true`, `forceConsistentCasingInFileNames: true`, `noUnusedLocals: true`, `noUnusedParameters: true`. The base only adds the extras.

---

#### 4.4.2 `packages/server-git/tsconfig.json`

ESM package targeting Node 22. Extends root base; overrides module resolution and adds ESM + native-strip-types flags.

**Issues in current file:**
- `module: "Node16"` → use `"nodenext"` (superset, future-proof for Node 22+).
- `moduleResolution: "Node16"` → `"nodenext"`.
- Missing `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`.
- Not extending a shared base — all options duplicated.

**Target:**

```jsonc
// packages/server-git/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    // ESM / Node 22 specifics
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "erasableSyntaxOnly": true,   // required for Node.js --experimental-strip-types

    // Emit paths
    "outDir": "dist",
    "rootDir": "src",

    // Required for project references
    "composite": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

---

#### 4.4.3 `packages/vscode-extension/tsconfig.json`

VS Code extension host is CJS — `module: "commonjs"` is correct and intentional. The base's `verbatimModuleSyntax: true` is compatible with CJS (it requires `import type` for type-only imports, which is correct practice regardless). `erasableSyntaxOnly` must be **omitted** — the extension is compiled by `tsc`, not stripped by Node.

**Issues in current file:**
- `moduleResolution: "node10"` → `"node16"` (best available for CJS + `module: "commonjs"`).
- Missing `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- Not extending a shared base — all options duplicated.
- `engines.node` absent (see §4.6).

**Target:**

```jsonc
// packages/vscode-extension/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    // CJS / VS Code extension host specifics
    "module": "commonjs",
    "moduleResolution": "node16",
    "target": "ES2022",     // override: Electron host, not Node 22 native
    // erasableSyntaxOnly intentionally omitted — compiled by tsc, not stripped

    // Emit paths
    "outDir": "dist",
    "rootDir": "src",

    // Required for project references
    "composite": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

> The `target` override is necessary because VS Code's Electron host does not always track the latest V8 version. `ES2022` is the safe ceiling.

---

#### 4.4.4 Root `tsconfig.json` — Project References

Unchanged in function but now references both packages. Used by editors and `tsc --build`.

```jsonc
// tsconfig.json (repo root — no emit, references only)
{
  "files": [],
  "references": [
    { "path": "packages/server-git" },
    { "path": "packages/vscode-extension" }
  ]
}
```

---

### 4.5 Package.json Corrections

#### `packages/server-git/package.json`

**Issues:**
- `engines.node: ">=18.0.0"` → Node 18 EOL March 2025; update to `">=22.0.0"`.
- All `devDependencies` version strings → replace with `catalog:`.
- `exports` entries use bare string format — add explicit `import` / `types` sub-conditions for toolchain interop.
- Missing `"files": ["dist", "README.md"]` — without this, all files including sources are published.
- Script `"lint": "tsc --noEmit"` → rename to `"typecheck": "tsc --noEmit"`.
- Remove `"lint"` script — linting is run from the root only.

**Target devDependencies:**

```jsonc
"devDependencies": {
  "@tsconfig/node22":     "catalog:",
  "@types/node":          "catalog:",
  "@types/which":         "^3.0.4",
  "@vitest/coverage-v8":  "catalog:",
  "tsx":                  "^4.7.0",
  "typescript":           "catalog:",
  "vitest":               "catalog:"
}
```

**Target exports:**

```jsonc
"exports": {
  ".": {
    "import": {
      "types": "./dist/standalone.d.ts",
      "default": "./dist/standalone.js"
    }
  },
  "./embedded": {
    "import": {
      "types": "./dist/embedded.d.ts",
      "default": "./dist/embedded.js"
    }
  }
}
```

**Target engines:**

```jsonc
"engines": {
  "node": ">=22.0.0"
}
```

#### `packages/vscode-extension/package.json`

**Issues:**
- Missing `engines.node` field — add `">=22.0.0"`.
- All `devDependencies` version strings → replace with `catalog:` where applicable.
- Script `"lint": "tsc --noEmit"` → rename to `"typecheck": "tsc --noEmit"`.
- Remove `"lint"` script — linting is run from the root only.

**Target devDependencies:**

```jsonc
"devDependencies": {
  "@types/node":          "catalog:",
  "@types/vscode":        "^1.85.0",
  "@vitest/coverage-v8":  "catalog:",
  "@vscode/vsce":         "^3.2.2",
  "typescript":           "catalog:",
  "vitest":               "catalog:"
}
```

**Target engines:**

```jsonc
"engines": {
  "vscode": "^1.85.0",
  "node": ">=22.0.0"
}
```

---

### 4.6 Vitest Configuration

#### `packages/server-git/vitest.config.ts`

**Issues:**
- `globals: true` — reference guide recommends `false` (explicit imports are better for TypeScript).
- Missing `clearMocks: true` and `restoreMocks: true`.
- `coverage.reporter` uses `'json'` — should use `'lcov'` for CI integration (or keep `json` alongside).

**Target config:**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    pool: 'forks',
    clearMocks: true,
    restoreMocks: true,
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
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
```

> Note: removing `globals: true` requires adding explicit `import { describe, it, expect, vi } from 'vitest'` at the top of each test file. This is the breaking change to handle carefully.

#### `packages/vscode-extension/vitest.config.ts`

**Issues:**
- No `clearMocks` / `restoreMocks`.
- No coverage configuration or thresholds.
- `alias` for vscode mock — replace with `resolve.alias` using the official Vitest pattern.

**Target config:**

```ts
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
    clearMocks: true,
    restoreMocks: true,
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
```

---

### 4.7 Code Quality Fixes

#### 4.7.1 Node.js `node:` prefix — all built-in imports

All Node.js built-in module imports must use the `node:` prefix. This is both the modern convention and required by ESLint rule `import/no-nodejs-modules` / `n/prefer-node-protocol`.

Files affected:
- `packages/server-git/src/core/git-executor.ts`: `'child_process'` → `'node:child_process'`
- `packages/server-git/src/core/path-validator.ts`: `'path'` → `'node:path'`
- `packages/server-git/src/core/repository-manager.ts`: audit for `'fs'`, `'path'`, etc.
- `packages/server-git/src/core/output-parser.ts`: audit for built-ins
- All other `src/**/*.ts` files in both packages.

#### 4.7.2 Eliminate `any` casts — `git-executor.ts`

```ts
// CURRENT — type-unsafe
if (error && !(error as any).code) {

// TARGET — typed
interface ExecError extends Error {
  code?: number | string;
}
if (error && !(error as ExecError).code) {
```

Or use a type guard:

```ts
function isExecError(e: unknown): e is { code: number | string } {
  return typeof e === 'object' && e !== null && 'code' in e;
}
if (error && !isExecError(error)) { ... }
```

#### 4.7.3 Cross-platform path handling — `path-validator.ts`

The current code normalises all paths to POSIX using `path.posix.join` / `path.posix.normalize`. On Windows, the repository root (`validatedRepo`) will be a Windows path (e.g. `C:\repos\foo`) but comparisons use POSIX separators. This can cause the containment check to fail or be bypassed.

**Fix:** Use `node:path` (platform-aware) throughout, or explicitly normalise both sides to the native separator before comparison.

```ts
import path from 'node:path';

// Replace path.posix.join / path.posix.normalize with:
const resolved = path.resolve(validatedRepo, filePath);
if (!resolved.startsWith(validatedRepo + path.sep) && resolved !== validatedRepo) {
  throw new GitMcpError(ErrorCode.SECURITY_ERROR, `Path outside repository: ${filePath}`, { ... });
}
```

> This is a **security fix** — OWASP A01 (path traversal). The current regex-based `DANGEROUS_PATTERNS` check is not sufficient on Windows since POSIX join on a Windows path can produce unexpected results.

---

## 5. Implementation Order

The following order minimises risk of broken builds between steps:

1. **Update `pnpm-workspace.yaml`** — add catalog (no code breaks)
2. **Update root `package.json`** — add `private`, `type`, `engines`, ESLint devDependencies, scripts
3. **Add `.npmrc`**
4. **Run `pnpm install`** — resolves catalog versions
5. **Create `tsconfig.base.json`** at repo root — install `@tsconfig/node22` at root first (`pnpm add -Dw @tsconfig/node22`)
6. **Update `packages/server-git/tsconfig.json`** — extend root base, slim down to overrides only
7. **Update `packages/vscode-extension/tsconfig.json`** — extend root base, slim down to overrides only
8. **Create root `tsconfig.json`** — project references with `composite: true` in each package
9. **Update package.json files** — `engines.node`, `catalog:` versions, rename `lint` → `typecheck`, add `files`
10. **Fix code quality issues** — `node:` prefix, `any` cast, path handling (tsc failures surface here under new strictness)
11. **Fix Vitest configs** — update both; add explicit vitest imports to test files (removing `globals: true`)
12. **Create root `eslint.config.mjs`** — single config; run `pnpm run lint`; fix violations
13. **Verify full build + test** — `pnpm -r run build`, `pnpm -r run test`, `pnpm run lint`

---

## 6. Acceptance Criteria

- [ ] `pnpm -r run build` succeeds with zero errors.
- [ ] `pnpm -r run typecheck` succeeds with zero errors.
- [ ] `pnpm -r run test` succeeds; all existing tests pass.
- [ ] `pnpm run lint` (root) succeeds with zero errors covering all packages.
- [ ] No `eslint.config.*` file exists inside any package directory.
- [ ] No `any` in `packages/server-git/src/**` (enforced by root ESLint).
- [ ] All Node.js built-in imports use `node:` prefix.
- [ ] `path-validator.ts` uses platform-native path resolution.
- [ ] Coverage thresholds enforced in both Vitest configs.
- [ ] `vitest` 4.x, `typescript` 5.8, `@types/node` 22 in both packages (via `catalog:`).
- [ ] `pnpm-workspace.yaml` catalog is the single source of version truth — no raw semver ranges duplicated across packages.
- [ ] Both package `tsconfig.json` files extend `../../tsconfig.base.json` and only override package-specific options.
- [ ] `engines.node: ">=22.0.0"` present in root `package.json`, `server-git/package.json`, and `vscode-extension/package.json`.
- [ ] Root `tsconfig.json` uses project references; both packages have `"composite": true`.

---

## 7. Risk Assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| Vitest 1→4 test API breakages | Medium | Run tests after upgrade; fix `describe`/`it` imports if `globals: false` |
| `verbatimModuleSyntax` requires `import type` | Medium | tsc will surface all violations immediately; fix file-by-file |
| `noUncheckedIndexedAccess` causes many guard failures | Low-Medium | Fix one file at a time; keep focused scope |
| `exactOptionalPropertyTypes` breaks zod schemas | Low | Zod 3.x is compatible; test after enabling |
| Path-validator fix changes security semantics | Low | All existing security tests must still pass |
| VS Code extension module format changes | None | Keeping `module: "commonjs"` — no format change |
| Root ESLint can't find per-package tsconfig | Low | `projectService: true` auto-discovers nearest tsconfig per file; verify with a dry run |
| `@tsconfig/node22` not found in `vscode-extension` | Low | Extension extends `../../tsconfig.base.json` which extends `@tsconfig/node22`; install `@tsconfig/node22` at workspace root with `-w` flag |
