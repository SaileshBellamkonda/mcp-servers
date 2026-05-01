# TypeScript tsconfig.json Best Practices

## Choosing a Base Config

Prefer an official base from `@tsconfig/*` rather than writing everything from scratch.

```bash
pnpm add -D @tsconfig/node22        # Node.js 22 (recommended for new projects)
pnpm add -D @tsconfig/node20        # Node.js 20
pnpm add -D @tsconfig/strictest     # Maximum strictness (any runtime)
```

Reference: https://github.com/tsconfig/bases

---

## Node.js App / Service (ESM, Node 22+)

```jsonc
// tsconfig.json
{
  "extends": "@tsconfig/node22/tsconfig.json",
  "compilerOptions": {
    // Strictness (additions on top of base)
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,

    // Emit
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true,

    // Module (nodenext handles both ESM .js and CJS .cjs)
    "module": "nodenext",
    "moduleResolution": "nodenext",

    // Safety
    "verbatimModuleSyntax": true,   // replaces deprecated importsNotUsedAsValues
    "erasableSyntaxOnly": true      // for Node.js --experimental-strip-types compat
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

> `@tsconfig/node22` already sets `"strict": true`, `"target": "ES2023"`, `"module": "node16"`. Override `module` + `moduleResolution` to `nodenext` for the latest interop.

---

## Library Package (Dual ESM + CJS or ESM-only)

```jsonc
// tsconfig.json
{
  "extends": "@tsconfig/node22/tsconfig.json",
  "compilerOptions": {
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,

    // Emit declarations
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",

    "module": "nodenext",
    "moduleResolution": "nodenext",
    "verbatimModuleSyntax": true,

    // Optional: for go-to-definition from consumers
    "declarationDir": "dist"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.spec.ts"]
}
```

For libraries wanting `isolatedDeclarations` (faster declaration emit, Rolldown/oxc compatibility):
```jsonc
"isolatedDeclarations": true   // requires explicit return types on all exported functions
```

---

## Monorepo Root (References / Project References)

```jsonc
// tsconfig.json (root — no emit, just for editors)
{
  "files": [],
  "references": [
    { "path": "./packages/pkg-a" },
    { "path": "./packages/pkg-b" }
  ]
}
```

Each package has its own `tsconfig.json` extending from a shared base:
```jsonc
// packages/pkg-a/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": true          // required for project references
  },
  "include": ["src/**/*"]
}
```

---

## Key Compiler Options Reference

| Option | Recommended Value | Why |
|--------|------------------|-----|
| `strict` | `true` | Enables all strict checks |
| `noUncheckedIndexedAccess` | `true` | Catches undefined from array/object access |
| `exactOptionalPropertyTypes` | `true` | Distinguishes `{ x?: T }` from `{ x: T \| undefined }` |
| `noPropertyAccessFromIndexSignature` | `true` | Forces bracket notation for index-typed properties |
| `verbatimModuleSyntax` | `true` | Replaces deprecated `importsNotUsedAsValues` + `preserveValueImports` |
| `erasableSyntaxOnly` | `true` | Required for Node.js `--experimental-strip-types` compat |
| `module` | `"nodenext"` | Correct Node.js ESM/CJS interop |
| `moduleResolution` | `"nodenext"` | Must match `module` |
| `isolatedModules` | `true` | Required for transpile-only tools (esbuild, swc) |
| `declaration` | `true` | Always required for libraries |
| `declarationMap` | `true` | Go-to-definition works in consumers |
| `sourceMap` | `true` | Debuggable stack traces |
| `composite` | `true` | Required for project references |
| `libReplacement` | `false` | Opt out of `@typescript/lib-*` lookup if unused |

---

## Deprecated / Avoid

| Option | Replaced By |
|--------|------------|
| `importsNotUsedAsValues` | `verbatimModuleSyntax` (deprecated in 5.5) |
| `preserveValueImports` | `verbatimModuleSyntax` (deprecated in 5.5) |
| `"module": "es2015"` through `"es2022"` for Node | `"module": "nodenext"` |
| `"moduleResolution": "node"` (classic) | `"moduleResolution": "nodenext"` or `"bundler"` |
| `paths` as runtime aliases | Use actual module resolution or a bundler |
| `namespace` / `module` with runtime code | Use ES modules; avoid if `erasableSyntaxOnly` |
| `enum` (when using Node.js type stripping) | `const` + `as const` or union types |
| Parameter properties | Avoid if `erasableSyntaxOnly` |

---

## tsconfig for Tests (Vitest / Jest)

```jsonc
// tsconfig.test.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["vitest/globals"],
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*", "**/*.test.ts", "**/*.spec.ts"]
}
```

Configure in `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    tsconfig: './tsconfig.test.json',
  },
});
```

---

## Module Extensions (nodenext)

With `"module": "nodenext"`, TypeScript enforces explicit extensions in imports:

```ts
// Correct — .js extension even for .ts source files
import { foo } from './foo.js';
import type { Bar } from './bar.js';

// Wrong — missing extension
import { foo } from './foo';
```

CJS files use `.cjs` / `.cts`, ESM files use `.mjs` / `.mts`.
