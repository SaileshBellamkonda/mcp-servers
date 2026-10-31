import path from 'node:path';
import type { DocumentLoader } from './types.ts';

export class LoaderRegistry {
  private readonly byExtension = new Map<string, DocumentLoader>();

  register(loader: DocumentLoader): void {
    const keys = loader.extensions.map((ext) => ext.toLowerCase());
    for (const key of keys) {
      if (this.byExtension.has(key)) {
        throw new Error(`Extension already registered: ${key}`);
      }
    }
    for (const key of keys) {
      this.byExtension.set(key, loader);
    }
  }

  getForFile(filePath: string): DocumentLoader | undefined {
    return this.byExtension.get(path.extname(filePath).toLowerCase());
  }

  isSupported(filePath: string): boolean {
    return this.getForFile(filePath) !== undefined;
  }

  extensions(): string[] {
    return [...this.byExtension.keys()].sort();
  }

  globPattern(): string {
    const exts = this.extensions().map((ext) => ext.replace(/^\./, ''));
    if (exts.length === 0) {
      throw new Error('No loaders registered');
    }
    return exts.length === 1 ? `**/*.${exts.join('')}` : `**/*.{${exts.join(',')}}`;
  }
}
