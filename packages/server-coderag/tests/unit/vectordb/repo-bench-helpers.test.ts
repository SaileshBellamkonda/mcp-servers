import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs, sampleSeeded, seededRandom, type RepoQueryFile } from '../../../scripts/lib/repo-bench.ts';

describe('bench:repo helpers', () => {
  it('parses the repository, language and comma separated include globs, ignoring a bare --', () => {
    const args = parseArgs(['--', '--repo', '/tmp/x', '--lang', 'go', '--include', 'a/**/*.go, b/*.go', '--seed', '7']);
    expect(args).toMatchObject({ repo: '/tmp/x', lang: 'go', include: ['a/**/*.go', 'b/*.go'], seed: 7, dim: 768 });
  });

  it('requires --repo and --lang', () => {
    expect(() => parseArgs(['--lang', 'go'])).toThrow(/Usage/);
    expect(() => parseArgs(['--repo', '/x', '--lang'])).toThrow(/Missing value/);
  });

  it('draws the same seeded sample every time and never repeats an item', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const first = sampleSeeded(items, 10, 1);
    expect(sampleSeeded(items, 10, 1)).toEqual(first);
    expect(new Set(first).size).toBe(10);
    expect(sampleSeeded(items, 10, 2)).not.toEqual(first);
    expect(sampleSeeded([1, 2, 3], 10, 1)).toHaveLength(3);
    expect(items).toHaveLength(50);
  });

  it('produces numbers in [0, 1)', () => {
    const random = seededRandom(3);
    for (let i = 0; i < 100; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('bench-data query files', () => {
  const dir = path.resolve(import.meta.dirname, '../../../scripts/bench-data');
  const languages = ['python', 'go', 'rust', 'java', 'csharp', 'typescript'];

  it.each(languages)('%s.json names its repository, commit and verified queries', (language) => {
    const file = path.join(dir, `${language}.json`);
    expect(existsSync(file)).toBe(true);
    const data = JSON.parse(readFileSync(file, 'utf8')) as RepoQueryFile;
    expect(data.repo).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
    expect(data.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(data.include.length).toBeGreaterThan(0);
    expect(data.queries.length).toBeGreaterThanOrEqual(10);
    expect(data.queries.every((q) => q.expect.length > 0)).toBe(true);
    expect((data.knownEdges ?? []).length).toBeGreaterThanOrEqual(10);
  });
});
