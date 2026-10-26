import { LoaderRegistry } from './registry.js';
import { MarkdownLoader } from './markdown.js';
import { MdxLoader } from './mdx.js';
import path from 'node:path';

export { LoaderRegistry, MarkdownLoader, MdxLoader };
export type { DocumentLoader, DocumentMetadata, DocumentSection, LoadedDocument } from './types.js';

export function createDefaultLoaderRegistry(): LoaderRegistry {
  const registry = new LoaderRegistry();
  registry.register(new MarkdownLoader());
  registry.register(new MdxLoader());
  return registry;
}

const defaultRegistry = createDefaultLoaderRegistry();

/**
 * Throws unless `filePath` is a document type the loaders understand. The frontmatter tools rewrite the
 * file, so they must not prepend a YAML block to a shell hook, `.env` file or other non-document.
 */
export function assertFrontmatterFile(filePath: string): void {
  if (defaultRegistry.isSupported(filePath)) return;
  throw new Error(
    `Frontmatter can only be edited in ${defaultRegistry.extensions().join(', ')} files; "${path.basename(filePath)}" is not a supported document type.`,
  );
}
