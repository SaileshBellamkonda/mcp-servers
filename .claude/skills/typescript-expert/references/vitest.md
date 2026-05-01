# Vitest Best Practices

## Versions (May 2026)

| Package | Version | Notes |
|---------|---------|-------|
| vitest | **4.x** | Requires Vite ≥ 6.0, Node.js ≥ 20 |
| @vitest/coverage-v8 | **4.x** | V8 native coverage — preferred over Istanbul |
| @vitest/ui | **4.x** | Optional browser-based test UI |

---

## Installation

```bash
pnpm add -D vitest @vitest/coverage-v8
```

For workspace (monorepo root):
```bash
pnpm add -Dw vitest @vitest/coverage-v8
```

Or use pnpm catalog:
```yaml
# pnpm-workspace.yaml
catalog:
  vitest: ^4.0.0
  '@vitest/coverage-v8': ^4.0.0
```

---

## Configuration (standalone — no Vite)

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test file patterns
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],

    // Globals: allows using describe/it/expect without importing
    // Prefer NOT using globals — explicit imports are better for TS
    globals: false,

    // Environment: 'node' (default) | 'jsdom' | 'happy-dom' | 'edge-runtime'
    environment: 'node',

    // Reset mocks between tests (recommended)
    clearMocks: true,
    restoreMocks: true,

    // Coverage
    coverage: {
      provider: 'v8',                   // preferred; 'istanbul' also available
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },

    // Reporters
    reporters: ['default'],             // 'verbose' for more detail

    // Timeouts (ms)
    testTimeout: 5000,
    hookTimeout: 10000,
  },
});
```

---

## Configuration (with Vite app)

```ts
// vitest.config.ts — extends vite.config.ts
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: false,
      clearMocks: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov'],
      },
    },
  })
);
```

---

## TypeScript Setup

Add types in `tsconfig.json` (or a separate `tsconfig.test.json`):

```jsonc
{
  "compilerOptions": {
    "types": ["vitest/globals"]   // only if globals: true in vitest.config.ts
  }
}
```

Without globals, import directly — this is the **preferred** approach:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

---

## Writing Tests

### Basic test structure

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { myFunction } from '../src/my-module.js';  // .js extension required for nodenext

describe('myFunction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns expected value for valid input', () => {
    const result = myFunction('valid');
    expect(result).toBe('expected');
  });

  it('throws for invalid input', () => {
    expect(() => myFunction('')).toThrow(TypeError);
  });
});
```

### Async tests

```ts
it('resolves correctly', async () => {
  const result = await fetchSomething();
  expect(result).toEqual({ ok: true });
});

it('rejects on error', async () => {
  await expect(fetchSomething('bad')).rejects.toThrow('Network error');
});
```

---

## Mocking

### `vi.fn()` — mock functions

```ts
const mockFn = vi.fn().mockReturnValue(42);
const mockAsync = vi.fn().mockResolvedValue({ data: 'ok' });
const mockReject = vi.fn().mockRejectedValue(new Error('fail'));

mockFn('arg');
expect(mockFn).toHaveBeenCalledWith('arg');
expect(mockFn).toHaveBeenCalledOnce();
```

### `vi.spyOn()` — spy on existing methods

```ts
import * as fs from 'node:fs/promises';

const spy = vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('content'));

// After test:
spy.mockRestore();  // or use restoreMocks: true in config
```

### Module mocking

```ts
vi.mock('../src/database.js', () => ({
  query: vi.fn().mockResolvedValue([]),
}));

// Auto-mock (replaces all exports with vi.fn())
vi.mock('../src/utils.js');
```

Mock a module with a factory (before imports):
```ts
// This must be at the top of the test file — Vitest hoists vi.mock calls
vi.mock('../src/config.js', () => ({
  default: { apiKey: 'test-key', timeout: 1000 },
}));
```

### `vi.stubEnv()` — stub environment variables

```ts
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('API_KEY', 'mock-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
});
```

### Fake timers

```ts
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it('fires callback after delay', () => {
  const fn = vi.fn();
  setTimeout(fn, 1000);
  vi.advanceTimersByTime(1000);
  expect(fn).toHaveBeenCalledOnce();
});
```

---

## Type Testing

Vitest supports compile-time type assertions:

```ts
import { expectTypeOf, assertType } from 'vitest';

it('has correct return type', () => {
  expectTypeOf(myFunction).returns.toBeString();
  expectTypeOf(myFunction).parameter(0).toBeNumber();
});
```

Run type tests alongside unit tests — no extra config needed.

---

## In-Source Testing

Vitest supports embedding tests inside source files (disabled by default):

```ts
// src/utils.ts
export function add(a: number, b: number): number {
  return a + b;
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  it('adds two numbers', () => {
    expect(add(1, 2)).toBe(3);
  });
}
```

Enable in config:
```ts
test: {
  includeSource: ['src/**/*.ts'],
}
```

---

## Test Projects (Monorepo / Multiple Configs)

```ts
// vitest.config.ts (root workspace config)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*/vitest.config.ts',
      // or inline:
      {
        test: {
          name: 'unit',
          include: ['packages/*/tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
```

---

## package.json Scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage",
    "test:types": "vitest typecheck"
  }
}
```

---

## Common Pitfalls

| Pitfall | Fix |
|---------|-----|
| Forgetting `await` in async tests | Always `await` async assertions; Vitest catches unhandled rejections |
| `vi.mock()` not hoisted | `vi.mock()` is auto-hoisted to top of file; don't put it inside `describe`/`it` |
| Module path mismatch | Use the same path as the import in source, including `.js` extension for `nodenext` |
| Mocks leaking between tests | Use `clearMocks: true` + `restoreMocks: true` in config |
| `globals: true` without types | Add `"types": ["vitest/globals"]` to tsconfig or use explicit imports |
| Coverage not matching source | Check `include`/`exclude` patterns in `coverage` config |
| Slow tests from real timers | Use `vi.useFakeTimers()` for time-dependent logic |
| Testing implementation details | Test behavior and outputs, not internal state |

---

## Comparison with Jest

| Feature | Vitest | Jest |
|---------|--------|------|
| Config | `vitest.config.ts` | `jest.config.ts` |
| Mocking | `vi.fn()`, `vi.mock()` | `jest.fn()`, `jest.mock()` |
| Spy | `vi.spyOn()` | `jest.spyOn()` |
| Timers | `vi.useFakeTimers()` | `jest.useFakeTimers()` |
| Type tests | Built-in `expectTypeOf` | `tsd` (separate package) |
| ESM support | Native | Requires `--experimental-vm-modules` |
| Watch mode | Fast (Vite HMR) | Slower |
| Coverage | `@vitest/coverage-v8` | `jest --coverage` |
