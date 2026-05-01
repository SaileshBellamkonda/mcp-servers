# package.json Best Practices for TypeScript Projects

## Node.js App / Service

```jsonc
{
  "name": "my-service",
  "version": "1.0.0",
  "private": true,
  "type": "module",                          // ESM-first
  "packageManager": "pnpm@10.11.0",          // corepack-compatible; pin exact version
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=10.0.0"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "node --watch dist/index.js",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "clean": "rimraf dist"
  },
  "dependencies": { },
  "devDependencies": {
    "@eslint/js": "^9.0.0",
    "@tsconfig/node22": "^22.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "eslint": "^9.0.0",
    "prettier": "^3.0.0",
    "rimraf": "^6.0.0",
    "typescript": "^5.8.0",
    "typescript-eslint": "^8.0.0",
    "vitest": "^3.0.0"
  }
}
```

---

## Library Package (ESM-only)

```jsonc
{
  "name": "@scope/my-lib",
  "version": "1.0.0",
  "type": "module",
  "packageManager": "pnpm@10.11.0",
  "engines": {
    "node": ">=22.0.0"
  },
  "main": "./dist/index.js",            // legacy CJS fallback (optional)
  "module": "./dist/index.js",          // bundler hint
  "types": "./dist/index.d.ts",         // TypeScript declarations
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      }
    }
  },
  "files": ["dist", "README.md"],       // only publish built output
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "prepublishOnly": "pnpm run build && pnpm run typecheck",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@tsconfig/node22": "^22.0.0",
    "typescript": "^5.8.0",
    "vitest": "^3.0.0"
  }
}
```

---

## Dual ESM + CJS Library

```jsonc
{
  "exports": {
    ".": {
      "import": {
        "types": "./dist/esm/index.d.ts",
        "default": "./dist/esm/index.js"
      },
      "require": {
        "types": "./dist/cjs/index.d.cts",
        "default": "./dist/cjs/index.cjs"
      }
    }
  },
  "main": "./dist/cjs/index.cjs",
  "module": "./dist/esm/index.js",
  "types": "./dist/esm/index.d.ts"
}
```

Requires two tsconfig files (`tsconfig.esm.json`, `tsconfig.cjs.json`) and two build steps.

---

## `exports` Field Rules

- Always include `types` condition **before** `default` / `import` / `require`
- TypeScript resolves types via the `types` condition under `--moduleResolution bundler` or `nodenext`
- Sub-path exports: `"./utils": { "import": "./dist/utils.js", "types": "./dist/utils.d.ts" }`
- Omit `exports` only for very simple private packages
- `"."` entry is the package root; `"./package.json"` should also be exposed if consumers need it

---

## `packageManager` Field (Corepack)

Enables Corepack to automatically install and use the correct pnpm version:

```jsonc
"packageManager": "pnpm@10.11.0+sha512.abc123..."   // with hash for security
```

Generate with:
```bash
corepack use pnpm@latest-10
```

This writes the correct entry (with integrity hash) to `package.json`.

---

## Scripts Conventions

| Script | Purpose |
|--------|---------|
| `build` | Compile TypeScript to `dist/` |
| `typecheck` | `tsc --noEmit` — type-check without emitting |
| `lint` | `eslint .` |
| `lint:fix` | `eslint . --fix` |
| `format` | `prettier --write .` |
| `format:check` | `prettier --check .` |
| `test` | `vitest run` (single-run) |
| `test:watch` | `vitest` (watch mode) |
| `test:coverage` | `vitest run --coverage` |
| `clean` | Remove `dist/`, `coverage/` |
| `prepublishOnly` | Build + typecheck before `pnpm publish` |

---

## Common DevDependencies (2026)

```jsonc
{
  "devDependencies": {
    // TypeScript
    "typescript": "^5.8.0",
    "@tsconfig/node22": "^22.0.0",        // or node20, strictest

    // Linting
    "eslint": "^9.0.0",
    "@eslint/js": "^9.0.0",
    "typescript-eslint": "^8.0.0",

    // Formatting
    "prettier": "^3.0.0",

    // Testing
    "vitest": "^3.0.0",
    "@vitest/coverage-v8": "^3.0.0",

    // Utilities
    "rimraf": "^6.0.0",                  // cross-platform rm -rf
    "tsx": "^4.0.0"                      // run TS directly (dev scripts)
  }
}
```

---

## `.npmrc` Conventions

```ini
# .npmrc (at package or workspace root)
engine-strict=true          # fail if Node.js/pnpm version doesn't match engines
save-exact=false            # use ^ prefix (default)
```

---

## Avoid

| Pattern | Why |
|---------|-----|
| `"main": "index.js"` without `"exports"` | Old pattern; no sub-path control, no types condition |
| `"types": "index.d.ts"` at root level only | Fine for simple libs, but `"exports".types` takes precedence |
| `"scripts": { "prepare": "npm run build" }` | `prepare` runs on `pnpm install` — prefer `prepublishOnly` |
| Pinning exact dep versions in libraries | Use `^` ranges; apps/services can pin |
| `"resolutions"` (yarn syntax) | Use `pnpm.overrides` instead |
| Publishing `src/` to npm | Always publish `dist/` + `files` field |
| No `"engines"` field | Always declare minimum Node.js version |
