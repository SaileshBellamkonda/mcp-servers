import type { DocumentLoader, LoadedDocument } from './types.ts';
import { isFenceClose, matchFenceOpen, type Fence } from './fence.ts';
import { loadMarkdownLike } from './markdown.ts';

// An MDX ESM block starts with a column-0 import/export statement and runs to the next blank line.
// `import x from` only counts when a quoted module follows, so prose such as "import data from the cache"
// is left alone.
const ESM_START =
  /^(?:import\s*(?:[{*'"]|\w+\s*(?:,|from\s*['"]))|export\s+(?:const|let|var|function|async|class|default|type|interface|enum)\b|export\s*[{*])/;
const COMPONENT_LINE = /^\s*<\/?[A-Z]/;
const SELF_CLOSING = /<[A-Z][\w.]*(?:\s[^<>]*)?\/>/g;
const COMPONENT_TAG = /<\/?[A-Z][\w.]*(?:\s[^<>]*)?>/g;
// Splitting on a capturing group puts inline code spans at the odd indices.
const CODE_SPAN = /(`[^`\n]*`)/;

/** Removes complete {/* ... *\/} comments in linear time (each search runs at most once past a miss). */
function stripComments(text: string): string {
  let out = '';
  let position = 0;
  for (;;) {
    const start = text.indexOf('{/*', position);
    if (start === -1) return out + text.slice(position);
    const end = text.indexOf('*/}', start + 3);
    if (end === -1) return out + text.slice(position);
    out += text.slice(position, start);
    position = end + 3;
  }
}

/**
 * Strips MDX-only syntax from one ordinary line, leaving inline code spans untouched. `commentOpened` is
 * true when the line ends inside a {/* comment that continues on the following lines.
 */
function renderLine(line: string): { text: string; commentOpened: boolean } {
  const componentLine = COMPONENT_LINE.test(line);
  const parts = line.split(CODE_SPAN);
  let out = '';
  for (const [index, part] of parts.entries()) {
    if (index % 2 === 1) {
      out += part;
      continue;
    }
    let text = stripComments(part);
    const commentStart = text.indexOf('{/*');
    if (commentStart !== -1) text = text.slice(0, commentStart);
    text = text.replace(SELF_CLOSING, '');
    if (componentLine) text = text.replace(COMPONENT_TAG, '');
    out += text;
    if (commentStart !== -1) return { text: out, commentOpened: true };
  }
  return { text: out, commentOpened: false };
}

/**
 * Removes MDX-only syntax (ESM blocks, {/* comments, JSX component tags) from a body.
 * Lines are blanked rather than deleted so line numbers stay stable. Fenced code is never touched.
 * Line endings are normalised to \n.
 */
export function stripMdx(body: string): string {
  const out: string[] = [];
  let fence: Fence | null = null;
  let inEsm = false;
  let inComment = false;

  for (const line of body.split(/\r?\n/)) {
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
        continue;
      }
      const rest = renderLine(line.slice(end + 3));
      inComment = rest.commentOpened;
      out.push(rest.text);
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

    const rendered = renderLine(line);
    inComment = rendered.commentOpened;
    out.push(rendered.text);
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
