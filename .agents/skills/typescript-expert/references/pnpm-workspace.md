# pnpm Workspace Best Practices

## pnpm Version Compatibility (May 2026)

| pnpm | Node.js |
|------|---------|
| 10.x | ≥ 18.12 |
| 9.x  | ≥ 16    |

Use pnpm 10.x for new projects (latest stable as of 2026).

---

## Workspace File Structure

```
my-monorepo/
├── pnpm-workspace.yaml     # required — defines workspace
├── package.json            # root package (private: true)
├── .npmrc                  # workspace-level npm config
├── tsconfig.json           # root tsconfig (references only)
├── eslint.config.mjs       # shared lint config
├── packages/
│   ├── pkg-a/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── pkg-b/
│       ├── package.json
│       └── tsconfig.json
```

---

## pnpm-workspace.yaml

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'apps/*'
  - '!**/node_modules/**'   # explicit exclusion (default already excluded)

# Catalog — centralize shared dependency versions (pnpm 9+)
catalog:
  typescript: ^5.8.0
  eslint: ^9.0.0
  '@eslint/js': ^9.0.0
  typescript-eslint: ^8.0.0
  vitest: ^3.0.0
  '@vitest/coverage-v8': ^3.0.0
  prettier: ^3.0.0

# Named catalogs for different ecosystems
catalogs:
  node22:
    '@tsconfig/node22': ^22.0.0
```

---

## Root package.json

```jsonc
{
  "name": "my-monorepo",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.11.0",
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=10.0.0"
  },
  "scripts": {
    // Run in all packages
    "build": "pnpm -r run build",
    "typecheck": "pnpm -r run typecheck",
    "lint": "pnpm -r run lint",
    "test": "pnpm -r run test",
    "clean": "pnpm -r run clean",

    // Run only changed packages (requires --filter)
    "build:changed": "pnpm -r --filter='[origin/main]' run build"
  },
  // Override a transitive dep version workspace-wide
  "pnpm": {
    "overrides": {
      "some-vulnerable-pkg": "^2.0.0"
    }
  }
}
```

---

## Package-level package.json (using catalog)

```jsonc
{
  "name": "@scope/pkg-a",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@scope/pkg-b": "workspace:*"        // local workspace package
  },
  "devDependencies": {
    "typescript": "catalog:",            // catalog: shorthand = catalog:default
    "vitest": "catalog:",
    "@tsconfig/node22": "catalog:node22" // named catalog
  }
}
```

---

## Workspace Protocol

| Syntax | Meaning |
|--------|---------|
| `workspace:*` | Any version (use the local copy always) — **preferred** |
| `workspace:~` | Compatible patch (local copy, published as `~x.y.z`) |
| `workspace:^` | Compatible minor (local copy, published as `^x.y.z`) |
| `workspace:1.2.3` | Exact version required (fails if not present) |

On `pnpm publish`, `workspace:*` is replaced with the package's actual version.

---

## Catalog Protocol

```yaml
# pnpm-workspace.yaml
catalog:
  react: ^18.3.1
```

```jsonc
// package.json
{
  "dependencies": {
    "react": "catalog:"   // resolved to ^18.3.1
  }
}
```

Benefits:
- One place to update a shared dependency version
- Prevents version drift across packages
- Fewer merge conflicts in `package.json` files

Migrate existing workspace with:
```bash
pnpx codemod pnpm/catalog
```

---

## Filtering Commands

```bash
# Run in a specific package
pnpm --filter @scope/pkg-a build

# Run in all packages matching a glob
pnpm --filter "./packages/*" build

# Run only in packages changed since main branch
pnpm --filter='[origin/main]' test

# Run in a package and all its dependencies
pnpm --filter @scope/pkg-a... build

# Run in a package and all its dependents (reverse)
pnpm --filter ...@scope/pkg-a build
```

---

## Shared TypeScript Config

```jsonc
// tsconfig.base.json (root)
{
  "extends": "@tsconfig/node22/tsconfig.json",
  "compilerOptions": {
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

```jsonc
// tsconfig.json (root — project references, editor-only)
{
  "files": [],
  "references": [
    { "path": "./packages/pkg-a" },
    { "path": "./packages/pkg-b" }
  ]
}
```

```jsonc
// packages/pkg-a/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "references": [
    { "path": "../pkg-b" }
  ],
  "include": ["src/**/*"]
}
```

Build all with project references:
```bash
tsc -b tsconfig.json          # incremental, respects references
tsc -b tsconfig.json --force  # force full rebuild
```

---

## .npmrc for Workspaces

```ini
# .npmrc
engine-strict=true
link-workspace-packages=false   # use workspace: protocol explicitly (recommended)
shared-workspace-lockfile=true  # single pnpm-lock.yaml at root (default: true)
```

---

## Release / Versioning

pnpm does not include a built-in versioning tool. Use one of:

| Tool | Command | Notes |
|------|---------|-------|
| [Changesets](https://github.com/changesets/changesets) | `pnpm add -Dw @changesets/cli` | Most popular for pnpm monorepos |
| [Rush](https://rushjs.io/) | — | Full monorepo management suite |

Changesets workflow:
```bash
pnpm changeset          # describe the change
pnpm changeset version  # bump versions + update changelogs
pnpm changeset publish  # publish to npm
```

---

## Common Pitfalls

| Pitfall | Fix |
|---------|-----|
| Missing `pnpm-workspace.yaml` | File is required; workspace won't be recognized without it |
| Using `"*"` version for workspace dep | Use `workspace:*` to ensure local resolution |
| No `"private": true` on root | Root package should never be published |
| Different versions of a dep across packages | Use `catalog:` to enforce one version |
| `node_modules` in package, not root | `shared-workspace-lockfile=true` (default) puts all deps in root `node_modules` |
| Circular workspace dependencies | pnpm warns; use `disallowWorkspaceCycles: true` to hard-fail |
| `pnpm install` in a sub-package | Always run from workspace root to maintain shared lockfile |
