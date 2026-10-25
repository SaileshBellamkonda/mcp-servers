import type { DocumentLoader, LoadedDocument } from './types.js';
import { isFenceClose, matchFenceOpen, type Fence } from './fence.js';
import { loadMarkdownLike } from './markdown.js';

// An MDX ESM block starts with a column-0 import/export statement and runs to the next blank line.
const ESM_START =
  /^(?:import\s*(?:[{*'"]|\w+\s*(?:,|from\b))|export\s+(?:const|let|var|function|async|class|default|type|interface|enum)\b|export\s*[{*])/;
const COMPONENT_LINE = /^\s*<\/?[A-Z]/;
const SELF_CLOSING = /<[A-Z][\w.]*(?:\s[^<>]*)?\/>/g;
const COMPONENT_TAG = /<\/?[A-Z][\w.]*(?:\s[^<>]*)?>/g;
const INLINE_COMMENT = /\{\/\*[\s\S]*?\*\/\}/g;

function cleanLine(text: string): string {
  let result = text.replace(SELF_CLOSING, '');
  if (COMPONENT_LINE.test(result)) result = result.replace(COMPONENT_TAG, '');
  return result;
}

/**
 * Removes MDX-only syntax (ESM blocks, {/* *\/} comments, JSX component tags) from a body.
 * Lines are blanked rather than deleted so line numbers stay stable. Fenced code is never touched.
 */
export function stripMdx(body: string): string {
  const out: string[] = [];
  let fence: Fence | null = null;
  let inEsm = false;
  let inComment = false;

  for (const line of body.split('\n')) {
    if (fence) {
      out.push(line);
      if (isFenceClose(line, fence)) fence = null;
      continue;
    }

    if (inEsm) {
      if (line.trim() === '') {
        inEsm = false;
        out.push(line);
      } else {
        out.push('');
      }
      continue;
    }

    if (inComment) {
      const end = line.indexOf('*/}');
      if (end === -1) {
        out.push('');
      } else {
        inComment = false;
        out.push(cleanLine(line.slice(end + 3)));
      }
      continue;
    }

    const opened = matchFenceOpen(line);
    if (opened) {
      fence = opened;
      out.push(line);
      continue;
    }

    if (ESM_START.test(line)) {
      inEsm = true;
      out.push('');
      continue;
    }

    let text = line.replace(INLINE_COMMENT, '');
    const commentStart = text.indexOf('{/*');
    if (commentStart !== -1) {
      inComment = true;
      text = text.slice(0, commentStart);
    }
    out.push(cleanLine(text));
  }

  return out.join('\n');
}

export class MdxLoader implements DocumentLoader {
  readonly name = 'mdx';
  readonly extensions: readonly string[] = ['.mdx'];

  load(filePath: string, source: string): LoadedDocument {
    return loadMarkdownLike(filePath, source, stripMdx);
  }
}
