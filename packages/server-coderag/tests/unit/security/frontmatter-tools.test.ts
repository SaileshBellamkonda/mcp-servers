import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerAddFrontmatter } from '../../../src/tools/add-frontmatter.js';
import { registerUpdateFrontmatter } from '../../../src/tools/update-frontmatter.js';
import matter from 'gray-matter';
import { parseFrontmatter, splitFrontmatter } from '../../../src/indexer/loaders/markdown.js';
import { PathGuard } from '../../../src/core/path-guard.js';

type Handler = (input: unknown) => unknown;

let root: string;
let handlers: Map<string, Handler>;

function fakeServer(): McpServer {
  handlers = new Map();
  return {
    registerTool: (name: string, _config: unknown, handler: Handler): void => { handlers.set(name, handler); },
  } as unknown as McpServer;
}

async function call(tool: string, input: unknown): Promise<unknown> {
  const handler = handlers.get(tool);
  if (!handler) throw new Error(`tool ${tool} not registered`);
  return await Promise.resolve().then(() => handler(input));
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'coderag-fm-')));
  const guard = new PathGuard([root]);
  const server = fakeServer();
  registerAddFrontmatter(server, guard);
  registerUpdateFrontmatter(server, guard);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe.each(['add_frontmatter', 'update_frontmatter'])('%s code frontmatter', (tool) => {
  for (const lang of ['js', 'javascript']) {
    it(`never executes ---${lang} frontmatter`, async () => {
      const sentinel = path.join(root, `pwned-${tool}-${lang}.txt`);
      const file = path.join(root, 'evil.md');
      const original = `---${lang}\n(require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'x'), {domain: 'x'})\n---\n# Title\n`;
      writeFileSync(file, original);

      const outcome = await call(tool, { filepath: file, domain: 'backend' }).then(
        (res) => ({ res }),
        (error: unknown) => ({ error }),
      );

      expect(existsSync(sentinel)).toBe(false);
      if ('error' in outcome) {
        expect(String(outcome.error)).toMatch(/not supported/i);
      } else {
        const text = (outcome.res as { content: { text: string }[] }).content[0]?.text ?? '';
        expect((JSON.parse(text) as { success: boolean }).success).toBe(false);
      }
      expect(readFileSync(file, 'utf8')).toBe(original);
    });
  }

  it('does not execute a ---js block hidden in the body after real frontmatter', async () => {
    const sentinel = path.join(root, `pwned-body-${tool}.txt`);
    const file = path.join(root, 'body.md');
    writeFileSync(file, `---\ntitle: ok\n---\n---js\n(require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'x'), {})\n---\n# Title\n`);
    await call(tool, { filepath: file, domain: 'backend' }).catch(() => undefined);
    expect(existsSync(sentinel)).toBe(false);
  });

  it('does not execute a ---js header when the file has no real frontmatter to protect', async () => {
    const sentinel = path.join(root, `pwned-noclose-${tool}.txt`);
    const file = path.join(root, 'noclose.md');
    writeFileSync(file, `---js\n(require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'x'), {})\n# never closed\n`);
    await call(tool, { filepath: file, domain: 'backend' }).catch(() => undefined);
    expect(existsSync(sentinel)).toBe(false);
  });
});

describe.each(['add_frontmatter', 'update_frontmatter'])('%s file types', (tool) => {
  for (const name of ['hook.sh', '.env', 'config.json', 'script.ts', 'notes.txt', 'README']) {
    it(`refuses ${name}`, async () => {
      const file = path.join(root, name);
      writeFileSync(file, 'echo hello\n');
      await expect(call(tool, { filepath: file, domain: 'backend' })).rejects.toThrow(/\.md/);
      expect(readFileSync(file, 'utf8')).toBe('echo hello\n');
    });
  }

  for (const name of ['a.md', 'b.markdown', 'c.mdx', 'D.MD']) {
    it(`still accepts ${name}`, async () => {
      mkdirSync(path.join(root, 'sub'), { recursive: true });
      const file = path.join(root, 'sub', name);
      writeFileSync(file, '# Hi\n');
      const res = (await call(tool, { filepath: file, domain: 'backend' })) as { content: { text: string }[] };
      expect((JSON.parse(res.content[0]?.text ?? '{}') as { success: boolean }).success).toBe(true);
      expect(readFileSync(file, 'utf8')).toMatch(/^---\n[\s\S]*domain: backend[\s\S]*---\n# Hi/);
    });
  }
});

describe('shared hardened parse', () => {
  it('is not served from gray-matter\'s default-engine cache', () => {
    const source = '---js\n({ domain: "cached" })\n---\n# Title\n';
    // Populate gray-matter's global cache through the default (eval-capable) entry point with a harmless expression.
    expect(matter(source).data).toEqual({ domain: 'cached' });
    expect(() => parseFrontmatter(source)).toThrow(/not supported/i);
    expect(splitFrontmatter(source).data).toEqual({});
  });
});
