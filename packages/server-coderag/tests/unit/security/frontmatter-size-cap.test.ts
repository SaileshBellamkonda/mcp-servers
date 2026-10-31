import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerAddFrontmatter } from '../../../src/tools/add-frontmatter.ts';
import { registerUpdateFrontmatter } from '../../../src/tools/update-frontmatter.ts';
import {
  MAX_FRONTMATTER_BYTES,
  MarkdownLoader,
  parseFrontmatter,
  splitFrontmatter,
} from '../../../src/indexer/loaders/markdown.ts';
import { PathGuard } from '../../../src/core/path-guard.ts';

type Handler = (input: unknown) => unknown;

// A merge-key chain makes js-yaml 3.x quadratic: ~230 KB blocks the event loop for several seconds.
function mergeChainFrontmatter(links: number): string {
  let yaml = 'a0: &a0 {k0: 1}\n';
  for (let i = 1; i < links; i++) yaml += `a${i}: &a${i} {<<: *a${i - 1}, k${i}: 1}\n`;
  return `---\n${yaml}---\n# Body\ntext\n`;
}

describe('frontmatter size cap', () => {
  const crafted = mergeChainFrontmatter(6400);

  it('crafted input is larger than the cap', () => {
    expect(crafted.length).toBeGreaterThan(MAX_FRONTMATTER_BYTES * 3);
    expect(MAX_FRONTMATTER_BYTES).toBe(64 * 1024);
  });

  it('parseFrontmatter rejects an oversized block quickly, before parsing it', () => {
    const start = performance.now();
    expect(() => parseFrontmatter(crafted)).toThrow(/frontmatter.*64 KB/i);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('splitFrontmatter indexes the document without frontmatter metadata, quickly', () => {
    const start = performance.now();
    const split = splitFrontmatter(crafted);
    expect(performance.now() - start).toBeLessThan(500);
    expect(split.data).toEqual({});
    expect(split.body).toBe(crafted);
    expect(split.lineOffset).toBe(0);
  });

  it('MarkdownLoader.load completes quickly and yields no metadata from the oversized block', () => {
    const start = performance.now();
    const doc = new MarkdownLoader().load('/x/big.md', crafted);
    expect(performance.now() - start).toBeLessThan(500);
    expect(doc.metadata.extra).toEqual({});
    expect(doc.metadata.tags).toEqual([]);
  });

  it('also caps a block that starts with a BOM and CRLF line endings', () => {
    const source = '﻿' + crafted.replace(/\n/g, '\r\n');
    const start = performance.now();
    expect(() => parseFrontmatter(source)).toThrow(/64 KB/);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('still parses a block just under the cap', () => {
    const filler = 'x'.repeat(100);
    let yaml = 'title: Big\n';
    while (yaml.length < MAX_FRONTMATTER_BYTES - 400) yaml += `note${String(yaml.length)}: ${filler}\n`;
    const source = `---\n${yaml}---\nbody\n`;
    expect(parseFrontmatter(source).data['title']).toBe('Big');
  });
});

describe('frontmatter tools with an oversized block', () => {
  let root: string;
  let handlers: Map<string, Handler>;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'coderag-fm-cap-')));
    handlers = new Map();
    const server = {
      registerTool: (name: string, _config: unknown, handler: Handler): void => { handlers.set(name, handler); },
    } as unknown as McpServer;
    const guard = new PathGuard([root]);
    registerAddFrontmatter(server, guard);
    registerUpdateFrontmatter(server, guard);
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  for (const [tool, input] of [
    ['add_frontmatter', { domain: 'backend' }],
    ['update_frontmatter', { domain: 'backend' }],
  ] as const) {
    it(`${tool} refuses with a clear error and leaves the file untouched`, async () => {
      const file = path.join(root, 'big.md');
      writeFileSync(file, mergeChainFrontmatter(6400));
      const before = readFileSync(file, 'utf8');
      const handler = handlers.get(tool);
      if (!handler) throw new Error('not registered');
      const start = performance.now();
      await expect(Promise.resolve().then(() => handler({ filepath: file, ...input }))).rejects.toThrow(/64 KB/);
      expect(performance.now() - start).toBeLessThan(500);
      expect(readFileSync(file, 'utf8')).toBe(before);
    });
  }
});
