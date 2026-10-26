import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodeParser } from '../../../src/indexer/code-parser.js';
import type { CodeChunk } from '../../../src/core/types.js';

let parser: CodeParser;
let dir: string;
let counter = 0;

beforeAll(() => {
  parser = new CodeParser();
  dir = mkdtempSync(path.join(tmpdir(), 'coderag-decorators-'));
});

afterAll(() => {
  parser.close();
  rmSync(dir, { recursive: true, force: true });
});

function parseFull(ext: string, source: string): ReturnType<CodeParser['parseFileWithRelations']> {
  const file = path.join(dir, `sample${String(counter++)}${ext}`);
  writeFileSync(file, source);
  return parser.parseFileWithRelations(file);
}

function find(chunks: CodeChunk[], name: string, type?: string): CodeChunk {
  const chunk = chunks.find((c) => c.symbolName === name && (type === undefined || c.symbolType === type));
  if (!chunk) throw new Error(`no chunk ${name}`);
  return chunk;
}

describe('Python decorators belong to the function or class they decorate', () => {
  const source = [
    'import app',
    '',
    '@app.route("/x")',
    '@login_required',
    'def view():',
    '    return 1',
    '',
    '@dataclass',
    'class Point(Base):',
    '    @property',
    '    def name(self):',
    '        return 1',
    '',
    'def plain():',
    '    pass',
  ].join('\n');

  it('starts the chunk at the first decorator and keeps the signature free of them', () => {
    const { chunks } = parseFull('.py', source);
    const view = find(chunks, 'view');
    expect(view.startLine).toBe(3);
    expect(view.endLine).toBe(6);
    expect(view.content.startsWith('@app.route("/x")\n@login_required\ndef view():')).toBe(true);
    expect(view.signature).toBe('def view():');

    const name = find(chunks, 'name');
    expect(name.startLine).toBe(10);
    expect(name.content.startsWith('@property\n')).toBe(true);
    expect(name.parentSymbol).toBe('Point');

    const plain = find(chunks, 'plain');
    expect(plain.startLine).toBe(14);
    expect(plain.content.startsWith('def plain')).toBe(true);
  });

  it('keeps a decorated class a container with its base classes', () => {
    const { chunks, relations } = parseFull('.py', source);
    const point = find(chunks, 'Point', 'class');
    expect(point.startLine).toBe(8);
    expect(point.content).toContain('class Point(Base):');
    expect(relations.relations.filter((r) => r.type === 'inherits').map((r) => r.targetName)).toEqual(['Base']);
  });
});

describe('Rust attributes belong to the item they annotate', () => {
  const source = [
    '#[derive(Debug, Clone)]',
    'struct S;',
    '',
    '#[test]',
    '#[ignore]',
    'fn it_works() {}',
    '',
    '/// Documented.',
    '#[inline]',
    'pub fn f() {}',
    '',
    'fn bare() {}',
  ].join('\n');

  it('starts the chunk at the first attribute', () => {
    const { chunks } = parseFull('.rs', source);
    const s = find(chunks, 'S');
    expect(s.startLine).toBe(1);
    expect(s.content.startsWith('#[derive(Debug, Clone)]\nstruct S;')).toBe(true);

    const test = find(chunks, 'it_works');
    expect(test.startLine).toBe(4);
    expect(test.content.startsWith('#[test]\n#[ignore]\nfn it_works')).toBe(true);
    expect(test.signature).toBe('fn it_works()');

    const f = find(chunks, 'f');
    expect(f.startLine).toBe(9);
    expect(f.content.startsWith('#[inline]\npub fn f()')).toBe(true);

    expect(find(chunks, 'bare').startLine).toBe(12);
  });
});
