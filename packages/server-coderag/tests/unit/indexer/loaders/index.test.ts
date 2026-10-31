import { describe, it, expect } from 'vitest';
import { createDefaultLoaderRegistry } from '../../../../src/indexer/loaders/index.ts';

describe('createDefaultLoaderRegistry', () => {
  it('registers the markdown and mdx loaders', () => {
    const registry = createDefaultLoaderRegistry();
    expect(registry.extensions()).toEqual(['.markdown', '.md', '.mdx']);
    expect(registry.getForFile('/docs/a.md')?.name).toBe('markdown');
    expect(registry.getForFile('/docs/a.markdown')?.name).toBe('markdown');
    expect(registry.getForFile('/docs/A.MDX')?.name).toBe('mdx');
  });

  it('builds a glob covering every registered extension', () => {
    expect(createDefaultLoaderRegistry().globPattern()).toBe('**/*.{markdown,md,mdx}');
  });

  it('does not support other formats', () => {
    const registry = createDefaultLoaderRegistry();
    expect(registry.isSupported('logo.png')).toBe(false);
    expect(registry.isSupported('notes.txt')).toBe(false);
  });
});
