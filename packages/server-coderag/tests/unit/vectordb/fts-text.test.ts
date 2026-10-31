import { describe, it, expect } from 'vitest';
import { splitIdentifier, expandIdentifiers, buildFtsQueries, symbolNameCandidates } from '../../../src/vectordb/fts-text.ts';

describe('splitIdentifier', () => {
  it.each([
    ['chunkMarkdown', ['chunk', 'markdown']],
    ['PathGuard', ['path', 'guard']],
    ['HTMLParser', ['html', 'parser']],
    ['parseHTTPResponse', ['parse', 'http', 'response']],
    ['sha256Hash', ['sha256', 'hash']],
    ['snake_case_name', ['snake', 'case', 'name']],
    ['__private_x', ['private', 'x']],
    ['MCP_AUTH_TOKEN', ['mcp', 'auth', 'token']],
    ['plain', ['plain']],
    ['ÜberCool', ['über', 'cool']],
    ['', []],
  ])('%s', (token, parts) => {
    expect(splitIdentifier(token)).toEqual(parts);
  });
});

describe('expandIdentifiers', () => {
  it('keeps the text and appends the words of compound identifiers once', () => {
    const out = expandIdentifiers('const chunkMarkdown = new PathGuard(); chunkMarkdown();');
    expect(out.startsWith('const chunkMarkdown = new PathGuard(); chunkMarkdown();')).toBe(true);
    const appended = out.slice(out.lastIndexOf('\n') + 1).split(' ');
    expect(appended).toEqual(['chunk', 'markdown', 'path', 'guard']);
  });

  it('splits snake_case, kebab-case and dotted paths into words', () => {
    const out = expandIdentifiers('last_docs_sync_at node-gyp-build src/vectordb/db.ts');
    const appended = out.slice(out.lastIndexOf('\n') + 1).split(' ');
    expect(appended).toEqual(expect.arrayContaining(['last', 'docs', 'sync', 'at']));
  });

  it('returns the text unchanged when nothing is compound', () => {
    expect(expandIdentifiers('plain words only')).toBe('plain words only');
  });
});

describe('buildFtsQueries', () => {
  it('returns null for blank or symbol-only input', () => {
    expect(buildFtsQueries('')).toBeNull();
    expect(buildFtsQueries('   ')).toBeNull();
    expect(buildFtsQueries('*** (( )) --')).toBeNull();
  });

  it('splits camelCase and snake_case and drops stop words', () => {
    const q = buildFtsQueries('how are the chunkMarkdown sections');
    expect(q?.strict).toBe('(("chunk" "markdown") OR "chunkmarkdown") AND "sections"*');
    expect(q?.loose).toBe('"chunk" OR "markdown" OR "sections"* OR "chunkmarkdown"');
  });

  it('uses prefix matching on the last term only, and not on a single character', () => {
    const q = buildFtsQueries('ab token validation');
    expect(q?.strict).toBe('"ab" AND "token" AND "validation"*');
    expect(buildFtsQueries('x')?.strict).toBe('"x"');
  });

  it('keeps all words when the query is only stop words', () => {
    expect(buildFtsQueries('how to')?.strict).toBe('"how" AND "to"*');
  });

  it('returns identical strict and loose queries for a single term', () => {
    expect(buildFtsQueries('guard')).toEqual({ strict: '"guard"*', loose: '"guard"*' });
  });

  it('ranks an exact whole-identifier match higher by adding the original token to the loose query', () => {
    const q = buildFtsQueries('PathGuard');
    expect(q?.strict).toBe('(("path" "guard"*) OR "pathguard")');
    expect(q?.loose).toBe('"path" OR "guard"* OR "pathguard"');
  });

  it('adds the whole snake_case token, which the index keeps as one token', () => {
    const q = buildFtsQueries('last_docs_sync_at');
    expect(q?.strict).toBe('(("last" "docs" "sync" "at"*) OR "last_docs_sync_at")');
    expect(q?.loose).toContain('OR "last_docs_sync_at"');
  });

  it.each([
    ['say "hello" world', ['"hello"', '"world"*']],
    ['foo AND bar OR baz NOT qux', ['"foo"', '"bar"', '"baz"', '"qux"*']],
    ['NEAR(xx yy, 5)', ['"near"', '"xx"', '"yy"', '"5"']],
    ['col:value -excluded', ['"col"', '"value"', '"excluded"*']],
    ['wild* card^ {x}', ['"wild"', '"card"', '"x"']],
  ])('neutralises FTS5 syntax in %s', (input, parts) => {
    const q = buildFtsQueries(input);
    expect(q).not.toBeNull();
    for (const part of parts) expect(q?.strict).toContain(part);
    // Besides our own quoted terms (letters, digits, '_', optional '*') only spaces, parentheses, AND and OR may remain.
    for (const expression of [q?.strict ?? '', q?.loose ?? '']) {
      expect(expression.replace(/"[\p{L}\p{N}_]+"\*?/gu, '').replace(/\b(?:OR|AND)\b/g, '')).toMatch(/^[\s()]*$/);
    }
  });

  it('caps the number of terms', () => {
    const q = buildFtsQueries(Array.from({ length: 60 }, (_, i) => `word${String(i)}x`).join(' '));
    expect((q?.strict.match(/"/g) ?? []).length / 2).toBeLessThanOrEqual(16);
  });
});

describe('symbolNameCandidates', () => {
  it('lists the lowercase words of the query with separators removed, and all of them joined', () => {
    expect([...symbolNameCandidates('extractSignature')]).toEqual(['extractsignature']);
    expect([...symbolNameCandidates('extract Signature')].sort()).toEqual(['extract', 'extractsignature', 'signature']);
    expect([...symbolNameCandidates('last_docs_sync_at')]).toEqual(['lastdocssyncat']);
  });

  it('is empty for blank input', () => {
    expect(symbolNameCandidates('  ... ').size).toBe(0);
  });
});
