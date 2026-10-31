import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { GlobMatcher } from '../../../src/core/glob-utils.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '../../../.tmp-glob-gitignore-test');
const tmpFwd = tmpDir.replace(/\\/g, '/');

function write(rel: string, content = 'x'): void {
  const full = path.join(tmpDir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function find(pattern: string, useGitignore = true): string[] {
  return new GlobMatcher([`${tmpFwd}/${pattern}`], [], tmpDir, useGitignore).findFiles().map((f) => path.relative(tmpFwd, f));
}

beforeEach(() => { mkdirSync(tmpDir, { recursive: true }); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe('GlobMatcher gitignore handling', () => {
  it('skips a directory named by a trailing-slash pattern, at any depth', () => {
    write('.gitignore', 'bin/\nobj/\n');
    write('src/app/Program.cs');
    write('src/app/bin/Debug/Generated.cs');
    write('src/app/obj/Generated.cs');
    write('bin/Top.cs');
    expect(find('**/*.cs')).toEqual(['src/app/Program.cs']);
  });

  it('skips a directory named by a character-class pattern like [Bb]in/', () => {
    write('.gitignore', '[Bb]in/\n[Oo]bj/\n');
    write('src/Keep.cs');
    write('src/Lib/Bin/Generated.cs');
    write('src/Lib/obj/Generated.cs');
    expect(find('**/*.cs')).toEqual(['src/Keep.cs']);
  });

  it('applies a root .gitignore file pattern at depth 3 and deeper', () => {
    write('.gitignore', 'secret.ts\n');
    write('a/b/c/secret.ts');
    write('a/b/c/d/secret.ts');
    write('a/b/c/public.ts');
    expect(find('**/*.ts')).toEqual(['a/b/c/public.ts']);
  });

  it('applies a nested .gitignore only inside its own subtree', () => {
    write('pkg/.gitignore', 'generated.ts\n');
    write('pkg/deep/generated.ts');
    write('pkg/deep/real.ts');
    write('other/generated.ts');
    expect(find('**/*.ts')).toEqual(['other/generated.ts', 'pkg/deep/real.ts']);
  });

  it('does not apply any .gitignore when useGitignore is false', () => {
    write('.gitignore', 'bin/\n');
    write('src/bin/Generated.cs');
    expect(find('**/*.cs', false)).toEqual(['src/bin/Generated.cs']);
  });
});

describe('GlobMatcher walk performance', () => {
  it('walks a few thousand entries quickly', () => {
    write('.gitignore', 'bin/\nobj/\n');
    for (let d = 0; d < 50; d++) {
      for (let f = 0; f < 40; f++) write(`src/m${String(d)}/f${String(f)}.ts`);
      for (let f = 0; f < 40; f++) write(`src/m${String(d)}/bin/g${String(f)}.ts`);
    }
    const started = Date.now();
    const files = find('**/*.ts');
    const elapsed = Date.now() - started;
    expect(files).toHaveLength(2000);
    expect(elapsed).toBeLessThan(2000);
  });
});
