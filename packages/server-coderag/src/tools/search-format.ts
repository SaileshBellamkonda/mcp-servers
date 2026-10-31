import path from 'node:path';
import { isPathWithin } from '../core/path-guard.ts';
import type { SearchResult } from '../core/types.ts';

const CODE_SNIPPET_LINES = 5;
const DOC_SNIPPET_LINES = 3;
const MAX_LINE_CHARS = 120;
/** Characters kept free for the "+N more results" line whenever more results may follow. */
const FOOTER_RESERVE_CHARS = 90;
const CONTAINER_TYPES = new Set(['class', 'struct', 'interface']);

export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Path relative to the first allowed root that contains it; a path under a later root is prefixed with that
 * root's folder name. A path outside every root is never shown absolute: only its last two segments remain.
 */
export function relativePath(file: string, roots: readonly string[]): string {
  for (const [index, root] of roots.entries()) {
    if (!isPathWithin(root, file)) continue;
    const relative = path.relative(root, file).split(path.sep).join('/') || path.basename(file);
    return index === 0 ? relative : `${path.basename(root)}/${relative}`;
  }
  const segments = file.split(/[\\/]+/).filter((s) => s !== '');
  return `…/${segments.slice(-2).join('/')}`;
}

/** Drops a class (or struct, interface) hit when another hit of the same file lies inside its line range. */
export function dropContainersOfMatches(results: readonly SearchResult[]): SearchResult[] {
  return results.filter((candidate) => {
    const outer = candidate.metadata;
    if (!outer || !CONTAINER_TYPES.has(outer.symbolType)) return true;
    return !results.some((other) => {
      const inner = other.metadata;
      return (
        other !== candidate &&
        inner !== undefined &&
        other.document === candidate.document &&
        inner.startLine >= outer.startLine &&
        inner.endLine <= outer.endLine &&
        (inner.startLine !== outer.startLine || inner.endLine !== outer.endLine)
      );
    });
  });
}

function clip(line: string): string {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS - 1)}…` : line;
}

/** Non-blank lines, dedented by their common indentation, closing-bracket-only lines removed, each clipped. */
function tidyLines(lines: readonly string[], max: number): string[] {
  const kept = lines.map((l) => l.trimEnd()).filter((l) => l.trim() !== '' && !/^\s*[}\])]+[;,]?$/.test(l)).slice(0, max);
  const indent = Math.min(...kept.map((l) => /^\s*/.exec(l)?.[0].length ?? 0));
  return kept.map((l) => clip(l.slice(Number.isFinite(indent) ? indent : 0)));
}

function squash(text: string): string {
  return text.replace(/[\s,]+/g, '');
}

/** The lines of a code chunk after its signature; an inline remainder such as `return 1;` counts as a line. */
function linesAfterSignature(content: string, signature: string): string[] {
  const lines = content.split('\n');
  const wanted = squash(signature.replace(/…$/, ''));
  if (wanted !== '') {
    let stripped = '';
    const origin: number[] = [];
    for (let i = 0; i < content.length; i++) {
      const ch = content.charAt(i);
      if (/[\s,]/.test(ch)) continue;
      stripped += ch;
      origin.push(i);
    }
    const at = stripped.indexOf(wanted);
    const end = at < 0 ? undefined : origin[at + wanted.length - 1];
    if (end !== undefined) {
      const lineEnd = content.indexOf('\n', end);
      const rest = content.slice(end + 1, lineEnd < 0 ? content.length : lineEnd).trim();
      const following = lineEnd < 0 ? [] : content.slice(lineEnd + 1).split('\n');
      return /[A-Za-z0-9_]/.test(rest) ? [rest, ...following] : following;
    }
  }
  return lines.slice(1);
}

function snippetOf(result: SearchResult): string[] {
  if (result.metadata) return tidyLines(linesAfterSignature(result.chunk, result.metadata.signature), CODE_SNIPPET_LINES);
  const lines = result.chunk.split('\n');
  const first = lines.find((l) => l.trim() !== '');
  const lastHeading = result.headingPath?.at(-1);
  const startsWithHeading = first !== undefined && lastHeading !== undefined && first.replace(/^\s*#+\s*/, '').trim() === lastHeading;
  return tidyLines(startsWithHeading ? lines.slice(lines.indexOf(first) + 1) : lines, DOC_SNIPPET_LINES);
}

function headerOf(result: SearchResult, roots: readonly string[]): string {
  const file = relativePath(result.document, roots);
  const score = `(${result.similarity.toFixed(2)})`;
  // The file changed after it was indexed: its lines may have moved. A background refresh is already under way.
  const staleMark = result.stale === true ? '(stale)' : '';
  const code = result.metadata;
  if (code) {
    const lines = code.startLine > 0 && code.endLine > 0 ? `:${String(code.startLine)}-${String(code.endLine)}` : '';
    const name = `${code.parentSymbol ? `${code.parentSymbol}.` : ''}${code.symbolName}`;
    return [`${file}${lines}`, code.symbolType, name, score, staleMark].filter((part) => part !== '').join(' ');
  }
  const lines = result.startLine === undefined
    ? ''
    : `:${String(result.startLine)}${result.endLine === undefined ? '' : `-${String(result.endLine)}`}`;
  const heading = result.headingPath && result.headingPath.length > 0 ? result.headingPath.join(' > ') : '';
  return [`${file}${lines}`, heading, score, staleMark].filter((part) => part !== '').join(' ');
}

function renderEntry(result: SearchResult, roots: readonly string[], withSnippet: boolean): string {
  const lines = [headerOf(result, roots)];
  const signature = result.metadata?.signature ?? '';
  if (signature !== '' && !restatesHeader(result)) lines.push(`  ${clipSignature(signature)}`);
  if (withSnippet) lines.push(...snippetOf(result).map((l) => `  ${l}`));
  return lines.join('\n');
}

/** A signature such as `interface Options` adds nothing to a header that already says `interface Options`. */
function restatesHeader(result: SearchResult): boolean {
  const code = result.metadata;
  if (!code) return false;
  const bare = code.signature.replace(/^(?:(?:export|pub|public|abstract|default)\s+)+/, '');
  return bare === `${code.symbolType} ${code.symbolName}`;
}

function clipSignature(signature: string): string {
  return signature.length > 200 ? `${signature.slice(0, 199)}…` : signature;
}

export interface ConciseOptions {
  roots: readonly string[];
  /** Results to skip before the page starts, counted in the de-duplicated list. */
  offset: number;
  /** Page size. */
  limit: number;
  maxTokens: number;
  mode: string;
}

/**
 * Compact text for a list of hits: one header line per hit (`path:start-end kind Parent.name (score)`), the signature
 * and a short snippet, indented by two spaces. Hits are added until the token budget is reached; the first hit is
 * always returned. If hits were left out, a last line gives their number and the offset to continue from.
 */
export function formatConcise(all: readonly SearchResult[], options: ConciseOptions): string {
  const { roots, offset, limit, maxTokens, mode } = options;
  const page = all.slice(offset, offset + limit);
  if (page.length === 0) {
    return mode === 'keyword' ? 'No results. Try other or fewer words, or mode=hybrid.' : 'No results.';
  }
  const budget = maxTokens * CHARS_PER_TOKEN;
  const blocks: string[] = [];
  let used = 0;
  for (const [index, result] of page.entries()) {
    const reserve = index < page.length - 1 ? FOOTER_RESERVE_CHARS : 0;
    let block = renderEntry(result, roots, true);
    if (blocks.length > 0 && used + block.length + 1 + reserve > budget) break;
    if (blocks.length === 0 && block.length + reserve > budget) block = renderEntry(result, roots, false);
    blocks.push(block);
    used += block.length + 1;
  }
  const remaining = all.length - offset - blocks.length;
  if (blocks.length < page.length) {
    blocks.push(`+${String(remaining)} more results; narrow the query or pass offset=${String(offset + blocks.length)}`);
  }
  return blocks.join('\n');
}
