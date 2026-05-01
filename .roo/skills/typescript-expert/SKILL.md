---
name: typescript-expert
description: "Expert in TypeScript, Node.js, pnpm, ESLint (flat config), typescript-eslint, Vitest, and OWASP-aware Node.js security. Use when: reviewing or generating TypeScript code; creating or auditing tsconfig.json, eslint.config.mjs, vitest.config.ts, or package.json; advising on pnpm workspace setup; asking TypeScript/Node.js best practices; checking for deprecations or latest versions; configuring typed linting; strict mode patterns; ESM vs CJS module decisions; writing or reviewing tests with Vitest; security code review against OWASP Top 10 for Node.js."
argument-hint: "Describe what you need: code review, config generation, test setup, security review, best-practice question, or version lookup"
---

# TypeScript Expert

Domain expert for TypeScript, Node.js, pnpm, ESLint, typescript-eslint, Vitest, and OWASP-aware Node.js security. Provides best-practice guidance, code review, config generation, and security-conscious development following current (2026) standards.

## Versions (current as of May 2026)

| Tool | Stable | Notes |
|------|--------|-------|
| TypeScript | **5.8** | 5.9 in dev; use `npm install typescript@next` for nightly |
| Node.js LTS | **v24** ("Krypton") | v22 also LTS; v18 EOL Mar 2025; v20 EOL Mar 2026 |
| Node.js Current | **v25** | EOL Mar 2026 |
| pnpm | **10.x** | Requires Node.js ≥ 18.12 |
| ESLint | **9.x** | Flat config (`eslint.config.*`) is the only supported format |
| typescript-eslint | **8.x** | Legacy `.eslintrc` support removed |
| Vitest | **4.x** | Requires Vite ≥ 6.0 and Node.js ≥ 20; use `vitest/config` for standalone config |

> Always verify with `npm view <package> version` or fetch the package page before locking versions in configs.

## When to Use This Skill

- Writing or reviewing TypeScript code (strict patterns, generics, type narrowing)
- Generating or auditing `tsconfig.json` for Node.js, libraries, or monorepos
- Setting up `eslint.config.mjs` with typescript-eslint (flat config)
- Configuring pnpm workspaces, catalogs, and `pnpm-workspace.yaml`
- Authoring `package.json` with correct `exports`, `engines`, and `packageManager` fields
- Answering questions about deprecations, breaking changes, or migration paths
- Setting up or reviewing Vitest (`vitest.config.ts`, mocking, coverage, typing)
- Security code review against OWASP Top 10 and Node.js-specific attack surfaces
- Identifying injection, prototype pollution, ReDoS, path traversal, and secrets-in-code issues

## Procedure

### 1. Clarify Context

Before generating configs or reviewing code, establish:
- **Runtime target**: Node.js (which version?), browser, Deno, Bun, or library?
- **Module format**: ESM (`"type":"module"`), CJS, or dual?
- **Monorepo?**: single package or pnpm workspace?
- **Type-checked linting?**: performance vs safety tradeoff

### 2. Apply Best Practices

Use the reference files for authoritative detail:
- [TypeScript & tsconfig best practices](./references/tsconfig.md)
- [ESLint flat config with typescript-eslint](./references/eslint-config.md)
- [package.json conventions](./references/package-json.md)
- [pnpm workspace patterns](./references/pnpm-workspace.md)
- [Vitest configuration & patterns](./references/vitest.md)
- [OWASP Node.js security review](./references/security.md)

### 3. Code Review Checklist

**TypeScript correctness:**
- [ ] `strict: true` is effective (no per-file overrides disabling it)
- [ ] No `any` unless explicitly justified with a comment
- [ ] `noUncheckedIndexedAccess` patterns respected (guard array/object access)
- [ ] `import type` used for type-only imports when `verbatimModuleSyntax` is on
- [ ] No `namespace` or `module` with runtime code (incompatible with `--erasableSyntaxOnly`)
- [ ] No `enum` if targeting Node.js native type-stripping
- [ ] No parameter properties in constructors if targeting Node.js native type-stripping
- [ ] Return types explicitly declared on exported functions
- [ ] No unused variables / imports (`@typescript-eslint/no-unused-vars`)
- [ ] `Promise` rejections handled (typed linting catches `@typescript-eslint/no-floating-promises`)

**Security (OWASP Node.js — see [security reference](./references/security.md)):**
- [ ] No `eval()`, `new Function()`, or `child_process.exec()` with user-controlled input
- [ ] All external inputs validated and typed at system boundaries
- [ ] No secrets / tokens hard-coded or logged
- [ ] No prototype pollution vectors (`Object.assign({}, userInput)` without sanitization)
- [ ] No ReDoS-vulnerable regexes on user-supplied strings
- [ ] No path traversal: `path.join` used, user input not concatenated directly into file paths
- [ ] `async/await` with `try/catch` — no unhandled promise rejections
- [ ] HTTP responses do not leak stack traces or internal paths
- [ ] `pnpm audit` / `npm audit` passes with no high/critical findings

**Testing (Vitest — see [vitest reference](./references/vitest.md)):**
- [ ] Tests use `vi.fn()` / `vi.spyOn()` — not manual monkey-patching
- [ ] Mocks are reset between tests (`clearMocks: true` or `vi.restoreAllMocks()`)
- [ ] Async tests properly `await` all assertions
- [ ] No `.only` or `.skip` left in committed test files
- [ ] Coverage thresholds enforced (`coverage.thresholds` in config)

### 4. Config Generation

When generating configs, always:
1. Ask for the target context (Node version, ESM vs CJS, library vs app)
2. Use the most appropriate tsconfig base from `@tsconfig/*` packages
3. Enable `strict: true` as the baseline — never weaken it
4. Use flat ESLint config (`eslint.config.mjs`) — never `.eslintrc.*`
5. Enable `projectService: true` for typed linting in non-trivial projects
6. Use `catalog:` protocol for shared deps in pnpm workspaces

### 5. Search for Latest Info

When versions, deprecations, or new features are mentioned:
- Fetch from `https://devblogs.microsoft.com/typescript/` for TypeScript news
- Fetch from `https://typescript-eslint.io/` for typescript-eslint changes
- Fetch from `https://eslint.org/blog/` for ESLint releases
- Fetch from `https://nodejs.org/en/about/releases` for Node.js LTS status
- Fetch from `https://vitest.dev/guide/migration` for Vitest breaking changes
- Fetch from `https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html` for latest Node.js OWASP guidance
- Use `npm view <package> version` to check the latest published version

## Key TypeScript 5.8 Features

- **`--module nodenext`**: now allows `require()` of ESM files (Node.js 22+)
- **`--module node18`**: stable flag for Node.js 18 users
- **`--erasableSyntaxOnly`**: errors on `enum`, `namespace` with runtime code, parameter properties — required for Node.js native type-stripping (`--experimental-strip-types`)
- **`--libReplacement false`**: opt out of `@typescript/lib-*` lookup if unused
- **Granular branch checks in return**: each ternary branch checked against return type individually
- **`verbatimModuleSyntax`**: preferred over `importsNotUsedAsValues` + `preserveValueImports` (both deprecated in 5.5)

## Common Pitfalls

| Pitfall | Correct Approach |
|---------|-----------------|
| `"module": "commonjs"` for new Node.js code | Use `"module": "nodenext"` + `"type": "module"` |
| `.eslintrc.json` or `.eslintrc.js` | Use `eslint.config.mjs` (flat config) |
| `parser: "@typescript-eslint/parser"` top-level | Handled automatically by `tseslint.config()` |
| `import assertions` (`assert { type: "json" }`) | Use `import attributes` (`with { type: "json" }`) |
| `enum` in Node.js type-stripped code | Use `const` object + `as const` or union string types |
| `"paths"` in tsconfig without bundler | Paths don't affect runtime resolution — use `moduleResolution: "nodenext"` |
| Forgetting `"declaration": true` in libraries | Always emit `.d.ts` for library packages |
| Using `require()` in ESM files | Use dynamic `import()` instead |
