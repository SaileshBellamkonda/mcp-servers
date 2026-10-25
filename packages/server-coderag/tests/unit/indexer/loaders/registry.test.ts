import { describe, it, expect } from 'vitest';
import { LoaderRegistry } from '../../../../src/indexer/loaders/registry.js';
import type { DocumentLoader, LoadedDocument } from '../../../../src/indexer/loaders/types.js';

function fakeLoader(name: string, extensions: string[]): DocumentLoader {
  return {
    name,
    extensions,
    load: (): LoadedDocument => ({ metadata: { tags: [], extra: {} }, sections: [] }),
  };
}

describe('LoaderRegistry', () => {
  it('returns the loader registered for a file extension', () => {
    const registry = new LoaderRegistry();
    const md = fakeLoader('markdown', ['.md']);
    registry.register(md);
    expect(registry.getForFile('/docs/readme.md')).toBe(md);
  });

  it('matches extensions case-insensitively', () => {
    const registry = new LoaderRegistry();
    const md = fakeLoader('markdown', ['.md']);
    registry.register(md);
    expect(registry.getForFile('/docs/README.MD')).toBe(md);
  });

  it('returns undefined for an unregistered extension', () => {
    const registry = new LoaderRegistry();
    registry.register(fakeLoader('markdown', ['.md']));
    expect(registry.getForFile('/docs/logo.png')).toBeUndefined();
  });

  it('reports support through isSupported', () => {
    const registry = new LoaderRegistry();
    registry.register(fakeLoader('markdown', ['.md']));
    expect(registry.isSupported('a.md')).toBe(true);
    expect(registry.isSupported('a.txt')).toBe(false);
  });

  it('throws when an extension is already registered and registers nothing from that loader', () => {
    const registry = new LoaderRegistry();
    registry.register(fakeLoader('first', ['.md']));
    expect(() => registry.register(fakeLoader('second', ['.txt', '.MD']))).toThrow('already registered');
    expect(registry.isSupported('x.txt')).toBe(false);
  });

  it('lists registered extensions sorted', () => {
    const registry = new LoaderRegistry();
    registry.register(fakeLoader('mdx', ['.mdx']));
    registry.register(fakeLoader('markdown', ['.md', '.markdown']));
    expect(registry.extensions()).toEqual(['.markdown', '.md', '.mdx']);
  });

  it('builds a brace glob for several extensions', () => {
    const registry = new LoaderRegistry();
    registry.register(fakeLoader('mdx', ['.mdx']));
    registry.register(fakeLoader('markdown', ['.md', '.markdown']));
    expect(registry.globPattern()).toBe('**/*.{markdown,md,mdx}');
  });

  it('builds a plain glob for a single extension', () => {
    const registry = new LoaderRegistry();
    registry.register(fakeLoader('markdown', ['.md']));
    expect(registry.globPattern()).toBe('**/*.md');
  });

  it('throws when building a glob with no loaders', () => {
    expect(() => new LoaderRegistry().globPattern()).toThrow('No loaders registered');
  });
});
