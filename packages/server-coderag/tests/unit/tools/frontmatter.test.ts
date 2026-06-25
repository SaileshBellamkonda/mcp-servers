import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '../../../.tmp-frontmatter-test');

function writeMd(filename: string, content: string): string {
  const filePath = path.join(tmpDir, filename);
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('gray-matter round-trip', () => {
  it('adds frontmatter to a file without it', () => {
    const filePath = writeMd('no-front.md', '# Hello\n\nBody text.');
    const raw = readFileSync(filePath, 'utf8');
    const parsed = matter(raw);
    expect(Object.keys(parsed.data)).toHaveLength(0);

    const newData = { domain: 'backend', tags: ['auth'] };
    const output = matter.stringify(parsed.content, newData);
    writeFileSync(filePath, output, 'utf8');

    const re = matter(readFileSync(filePath, 'utf8'));
    expect(re.data['domain']).toBe('backend');
    expect(re.data['tags']).toEqual(['auth']);
  });

  it('merges fields into existing frontmatter', () => {
    const filePath = writeMd('with-front.md', '---\ndomain: frontend\n---\n# Hello\n');
    const raw = readFileSync(filePath, 'utf8');
    const parsed = matter(raw);
    parsed.data['language'] = 'typescript';
    const output = matter.stringify(parsed.content, parsed.data);
    writeFileSync(filePath, output, 'utf8');

    const re = matter(readFileSync(filePath, 'utf8'));
    expect(re.data['domain']).toBe('frontend');
    expect(re.data['language']).toBe('typescript');
  });
});
