import { LoaderRegistry } from './registry.js';
import { MarkdownLoader } from './markdown.js';
import { MdxLoader } from './mdx.js';

export { LoaderRegistry, MarkdownLoader, MdxLoader };
export type { DocumentLoader, DocumentMetadata, DocumentSection, LoadedDocument } from './types.js';

export function createDefaultLoaderRegistry(): LoaderRegistry {
  const registry = new LoaderRegistry();
  registry.register(new MarkdownLoader());
  registry.register(new MdxLoader());
  return registry;
}
