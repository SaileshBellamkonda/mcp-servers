import { builtinModules } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, inject, it } from 'vitest';

describe('bundle-extension: dist/extension.js', () => {
  const { extensionJs, externalImports } = inject('bundle');
  const code = readFileSync(extensionJs, 'utf8');

  it('is a readable CommonJS bundle with a source map', () => {
    expect(code.split('\n').length).toBeGreaterThan(5000);
    expect(code).toMatch(/^Object\.defineProperty\(exports, Symbol\.toStringTag, \{ value: "Module" \}\);/);
    expect(existsSync(`${extensionJs}.map`)).toBe(true);
    expect(code).toMatch(/\/\/# sourceMappingURL=extension\.js\.map/);
  });

  it('exports activate and deactivate', () => {
    expect(code).toMatch(/^exports\.activate = activate;$/m);
    expect(code).toMatch(/^exports\.deactivate = deactivate;$/m);
  });

  it('leaves only "vscode" and Node built-ins external: every other dependency is bundled', () => {
    const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
    const unexpected = externalImports.filter((specifier) => specifier !== 'vscode' && !builtins.has(specifier));
    expect(unexpected).toEqual([]);
    expect(externalImports).toContain('vscode');
  });

  it('inlines the git and CodeRAG servers and the shared packages', () => {
    expect(code).toContain('git-server');
    expect(code).toContain('coderag-server');
    expect(code).toContain('probeCodeRagSupport');
    expect(code).toContain('startMcpHttpServer');
    expect(code).not.toMatch(/require\(["']@mcp-servers\//);
    expect(code).not.toMatch(/\bimport\(["']@mcp-servers\//);
  });
});
