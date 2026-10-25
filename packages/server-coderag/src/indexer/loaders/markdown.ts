import path from 'node:path';
import matter from 'gray-matter';
import type { DocumentLoader, DocumentMetadata, DocumentSection, LoadedDocument } from './types.js';
import { isFenceClose, matchFenceOpen, type Fence } from './fence.js';

const ATX_HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;

const KNOWN_KEYS = new Set(['title', 'tags', 'doc_type', 'docType', 'domain', 'project', 'language']);

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

/** Splits YAML frontmatter from the body. Malformed or non-mapping frontmatter is left in the body. */
export function splitFrontmatter(source: string): Frontmatter {
  try {
    const parsed = matter(source);
    if (!isRecord(parsed.data)) return { data: {}, body: source, lineOffset: 0 };
    const prefix = source.slice(0, source.length - parsed.content.length);
    return { data: parsed.data, body: parsed.content, lineOffset: countNewlines(prefix) };
  } catch {
    return { data: {}, body: source, lineOffset: 0 };
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

export function normalizeMetadata(data: Record<string, unknown>, fallbackTitle: string): DocumentMetadata {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!KNOWN_KEYS.has(key)) extra[key] = value;
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

    const heading = ATX_HEADING.exec(line);
    if (heading) {
      if (open) {
        const done = finish(open);
        if (done) sections.push(done);
      }
      const level = (heading[1] ?? '').length;
      const text = (heading[2] ?? '').trim();
      while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) stack.pop();
      stack.push({ level, text });
      if (level === 1) firstH1 ??= text;
      open = { headingPath: stack.map((entry) => entry.text), startLine: lineNo, lines: [line], hasHeading: true };
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
