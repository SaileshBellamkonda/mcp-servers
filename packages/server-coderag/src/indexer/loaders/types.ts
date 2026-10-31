import type { DocumentMetadata } from '../../core/types.ts';

export type { DocumentMetadata };

export interface DocumentSection {
  /** Ancestor headings plus the section's own heading; empty before the first heading. */
  headingPath: string[];
  /** Section text including its heading line. */
  text: string;
  /** 1-based line in the original file (frontmatter included in the count). */
  startLine: number;
  /** 1-based inclusive end line in the original file. */
  endLine: number;
}

export interface LoadedDocument {
  metadata: DocumentMetadata;
  sections: DocumentSection[];
}

export interface DocumentLoader {
  readonly name: string;
  /** Lower-case extensions including the dot, e.g. ".md". */
  readonly extensions: readonly string[];
  load(filePath: string, source: string): LoadedDocument;
}
