import path from 'node:path';
import matter from 'gray-matter';
import type { DocumentLoader, DocumentMetadata, DocumentSection, LoadedDocument } from './types.ts';
import { isFenceClose, matchFenceOpen, type Fence } from './fence.ts';
import { createStderrLogger } from '../../core/logger.ts';

const ATX_OPEN = /^ {0,3}(#{1,6})[ \t]/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
// Line starts that begin some other block, so the line cannot be a one-line paragraph that an underline promotes.
const NON_PARAGRAPH_START = /^ {0,3}(?:[-*+][ \t]|\d{1,9}[.)][ \t]|[>|<#]|`{3}|~{3})/;
const HAS_FRONTMATTER_OPEN = /^\uFEFF?---/;
const CLOSED_FRONTMATTER = /^\uFEFF?---[^\r\n]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

const KNOWN_KEYS = new Set(['title', 'tags', 'doc_type', 'docType', 'domain', 'project', 'language']);
const MAX_EXTRA_NODES = 1000; // per frontmatter value
const MAX_EXTRA_TOTAL_NODES = 5000; // across all accepted values
const MAX_EXTRA_DEPTH = 6;
/**
 * Largest frontmatter block (opening delimiter up to the closing one) that is parsed. js-yaml 3.x resolves
 * merge keys in quadratic time, so a ~230 KB block of chained `<<: *alias` entries blocks the event loop for
 * seconds. The limit is checked on the raw text, before any YAML is parsed.
 */
export const MAX_FRONTMATTER_BYTES = 64 * 1024;

interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
  lineOffset: number;
}

interface OpenSection {
  headingPath: string[];
  startLine: number;
  lines: string[];
  hasHeading: boolean;
}

// gray-matter's default `---js` / `---javascript` engines eval the header. Documents are untrusted input,
// so those engines are disabled everywhere frontmatter is read or written (this module is the only place
// that touches gray-matter). Passing an options object also bypasses gray-matter's global per-input cache
// (it is only consulted when no options are given), so a result parsed here can never be served from, or
// stored for, a parse made with the default eval-capable engines.
function disabledEngine(): never {
  throw new Error('Code frontmatter (---js / ---javascript) is not supported');
}
const MATTER_OPTIONS = { engines: { js: disabledEngine, javascript: disabledEngine } };

const sizeLogger = createStderrLogger('coderag-markdown');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function countNewlines(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (ch === '\n') count++;
  }
  return count;
}

function noFrontmatter(source: string): Frontmatter {
  return { data: {}, body: source, lineOffset: 0 };
}

/** Thrown instead of parsing a frontmatter block larger than {@link MAX_FRONTMATTER_BYTES}. */
export class FrontmatterTooLargeError extends Error {
  constructor(size: number) {
    super(
      `Frontmatter block is ${String(size)} characters, over the ${String(MAX_FRONTMATTER_BYTES / 1024)} KB limit, ` +
        'so it was not parsed. Frontmatter tools leave the file unchanged, and indexing treats the document as plain text ' +
        'without frontmatter metadata. Shorten the frontmatter to fix this.',
    );
    this.name = 'FrontmatterTooLargeError';
  }
}

/**
 * Length of the text gray-matter would hand to the YAML parser: from the opening `---` to the first line that
 * starts with `---` (gray-matter's own closing rule). Zero when there is no frontmatter opening. Scans with
 * indexOf only, never parsing.
 */
function frontmatterBlockSize(source: string): number {
  const start = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (!source.startsWith('---', start)) return 0;
  const close = source.indexOf('\n---', start + 3);
  return (close === -1 ? source.length : close) - start;
}

/**
 * Parses YAML (or JSON) frontmatter with code engines disabled. Returns an empty mapping when the header is
 * absent or never closed. Throws on code (`---js`), malformed or non-mapping frontmatter, so callers that
 * would rewrite the file can refuse instead of silently overwriting it.
 */
export function parseFrontmatter(source: string): { data: Record<string, unknown>; content: string } {
  // gray-matter treats an unterminated header as running to the end of the file, so never hand it one.
  if (HAS_FRONTMATTER_OPEN.test(source) && !CLOSED_FRONTMATTER.test(source)) return { data: {}, content: source };
  const size = frontmatterBlockSize(source);
  if (size > MAX_FRONTMATTER_BYTES) {
    throw new FrontmatterTooLargeError(size);
  }
  const parsed = matter(source, MATTER_OPTIONS);
  if (!isRecord(parsed.data)) throw new Error('Frontmatter must be a mapping of keys to values');
  return { data: parsed.data, content: parsed.content };
}

/** Writes `data` as YAML frontmatter above `content` without re-parsing `content` for another header. */
export function stringifyFrontmatter(content: string, data: Record<string, unknown>): string {
  return matter.stringify({ content }, data, MATTER_OPTIONS);
}

/**
 * Splits YAML frontmatter from the body. Unterminated, malformed, non-mapping or code (`---js`) frontmatter
 * is left in the body.
 */
export function splitFrontmatter(source: string): Frontmatter {
  try {
    const parsed = parseFrontmatter(source);
    const prefix = source.slice(0, source.length - parsed.content.length);
    return { data: parsed.data, body: parsed.content, lineOffset: countNewlines(prefix) };
  } catch (error) {
    if (error instanceof FrontmatterTooLargeError) {
      // Without the cap the document would stall the server; it is indexed as plain text instead.
      sizeLogger.warning(error.message);
    }
    return noFrontmatter(source);
  }
}

function asText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function asTags(value: unknown): string[] {
  let items: unknown[] = [];
  if (Array.isArray(value)) items = value as unknown[];
  else if (typeof value === 'string') items = value.split(',');
  const tags: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string' && typeof item !== 'number') continue;
    const tag = String(item).trim().toLowerCase();
    if (tag !== '' && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

// YAML aliases share structure, so a tiny header can expand to gigabytes when serialised, and an alias can
// point back at its own ancestor. Walk each value with a node and depth budget and refuse anything larger;
// a rejected value does not use up the budget of the others.
function withinBudget(value: unknown, budget: { nodes: number }, depth: number): boolean {
  budget.nodes--;
  if (budget.nodes < 0 || depth > MAX_EXTRA_DEPTH) return false;
  if (Array.isArray(value)) {
    return (value as unknown[]).every((item) => withinBudget(item, budget, depth + 1));
  }
  if (isRecord(value)) {
    return Object.values(value).every((item) => withinBudget(item, budget, depth + 1));
  }
  return true;
}

export function normalizeMetadata(data: Record<string, unknown>, fallbackTitle: string): DocumentMetadata {
  const extra: Record<string, unknown> = {};
  let acceptedNodes = 0;
  for (const [key, value] of Object.entries(data)) {
    if (KNOWN_KEYS.has(key)) continue;
    const allowance = Math.min(MAX_EXTRA_NODES, MAX_EXTRA_TOTAL_NODES - acceptedNodes);
    if (allowance <= 0) break;
    const budget = { nodes: allowance };
    if (withinBudget(value, budget, 0)) {
      extra[key] = value;
      acceptedNodes += allowance - budget.nodes;
    }
  }
  return {
    title: asText(data['title']) ?? fallbackTitle,
    tags: asTags(data['tags']),
    docType: asText(data['doc_type']) ?? asText(data['docType']),
    domain: asText(data['domain']),
    project: asText(data['project']),
    language: asText(data['language']),
    extra,
  };
}

/** Parses an ATX heading in linear time; a heading with no text is not treated as a heading. */
function parseAtxHeading(line: string): { level: number; text: string } | null {
  const open = ATX_OPEN.exec(line);
  if (!open) return null;
  let text = line.slice(open[0].length).trim();
  // Optional closing sequence: trailing #s that are separated from the text by whitespace.
  let end = text.length;
  while (end > 0 && text.charAt(end - 1) === '#') end--;
  if (end < text.length && (end === 0 || /[ \t]/.test(text.charAt(end - 1)))) {
    text = text.slice(0, end).trimEnd();
  }
  return text === '' ? null : { level: (open[1] ?? '').length, text };
}

/** True when the open section ends in a one-line paragraph that a following setext underline would promote. */
function isSetextCandidate(open: OpenSection): boolean {
  const last = open.lines.length - 1;
  const previous = open.lines[last];
  if (previous === undefined || previous.trim() === '') return false;
  if (last === 0 && open.hasHeading) return false;
  if (last > 0 && (open.lines[last - 1] ?? '').trim() !== '') return false;
  if (/^ {4}/.test(previous) || NON_PARAGRAPH_START.test(previous)) return false;
  if (SETEXT_UNDERLINE.test(previous) || matchFenceOpen(previous) !== null) return false;
  return true;
}

function pushHeading(stack: { level: number; text: string }[], level: number, text: string): string[] {
  while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) stack.pop();
  stack.push({ level, text });
  return stack.map((entry) => entry.text);
}

function finish(open: OpenSection): DocumentSection | null {
  let first = 0;
  let last = open.lines.length - 1;
  while (first <= last && (open.lines[first] ?? '').trim() === '') first++;
  while (last >= first && (open.lines[last] ?? '').trim() === '') last--;
  if (first > last) return null;
  // A heading with no body carries no content of its own.
  if (open.hasHeading && first === last) return null;
  return {
    headingPath: open.headingPath,
    text: open.lines.slice(first, last + 1).join('\n'),
    startLine: open.startLine + first,
    endLine: open.startLine + last,
  };
}

/** Splits a markdown body into heading sections. `lineOffset` is the number of lines already consumed (frontmatter). */
export function parseMarkdownBody(
  body: string,
  lineOffset: number,
): { sections: DocumentSection[]; firstH1: string | undefined } {
  const lines = body.split(/\r?\n/);
  const sections: DocumentSection[] = [];
  const stack: { level: number; text: string }[] = [];
  let firstH1: string | undefined;
  let open: OpenSection | undefined;
  let fence: Fence | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineNo = lineOffset + i + 1;

    if (fence) {
      open?.lines.push(line);
      if (isFenceClose(line, fence)) fence = null;
      continue;
    }

    const opened = matchFenceOpen(line);
    if (opened) {
      open ??= { headingPath: [], startLine: lineNo, lines: [], hasHeading: false };
      open.lines.push(line);
      fence = opened;
      continue;
    }

    const underline = SETEXT_UNDERLINE.exec(line);
    if (underline && open && isSetextCandidate(open)) {
      const titleLine = open.lines.pop() ?? '';
      const done = finish(open);
      if (done) sections.push(done);
      const level = (underline[1] ?? '').startsWith('=') ? 1 : 2;
      const text = titleLine.trim();
      const headingPath = pushHeading(stack, level, text);
      if (level === 1) firstH1 ??= text;
      open = { headingPath, startLine: lineNo - 1, lines: [titleLine, line], hasHeading: true };
      continue;
    }

    const heading = parseAtxHeading(line);
    if (heading) {
      if (open) {
        const done = finish(open);
        if (done) sections.push(done);
      }
      const headingPath = pushHeading(stack, heading.level, heading.text);
      if (heading.level === 1) firstH1 ??= heading.text;
      open = { headingPath, startLine: lineNo, lines: [line], hasHeading: true };
      continue;
    }

    open ??= { headingPath: [], startLine: lineNo, lines: [], hasHeading: false };
    open.lines.push(line);
  }

  if (open) {
    const done = finish(open);
    if (done) sections.push(done);
  }
  return { sections, firstH1 };
}

/** Shared pipeline for markdown-like formats; `transformBody` may rewrite the body but must keep its line count. */
export function loadMarkdownLike(
  filePath: string,
  source: string,
  transformBody: (body: string) => string,
): LoadedDocument {
  const { data, body, lineOffset } = splitFrontmatter(source);
  const { sections, firstH1 } = parseMarkdownBody(transformBody(body), lineOffset);
  const fallbackTitle = firstH1 ?? path.basename(filePath, path.extname(filePath));
  return { metadata: normalizeMetadata(data, fallbackTitle), sections };
}

export class MarkdownLoader implements DocumentLoader {
  readonly name = 'markdown';
  readonly extensions: readonly string[] = ['.md', '.markdown'];

  load(filePath: string, source: string): LoadedDocument {
    return loadMarkdownLike(filePath, source, (body) => body);
  }
}
