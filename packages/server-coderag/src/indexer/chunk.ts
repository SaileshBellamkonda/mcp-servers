import type { MarkdownChunk } from '../core/types.ts';
import type { DocumentSection } from './loaders/types.ts';
import { isFenceClose, matchFenceOpen } from './loaders/fence.ts';

const segmenter = new Intl.Segmenter();

/** Grapheme count; with `cap` it stops counting once the count exceeds it (result is then cap + 1). */
function segLen(str: string, cap = Number.POSITIVE_INFINITY): number {
  const iterator = segmenter.segment(str)[Symbol.iterator]();
  let count = 0;
  while (!iterator.next().done) {
    count++;
    if (count > cap) break;
  }
  return count;
}

function segArray(str: string): string[] {
  return [...segmenter.segment(str)].map(s => s.segment);
}

export function splitIntoChunks(content: string, chunkSize: number): string[] {
  const runes = segArray(content); // unicode-safe split
  if (runes.filter((c) => c.trim()).length === 0) return [];
  if (runes.length <= chunkSize) {
    const trimmed = content.trim();
    return trimmed ? [trimmed] : [];
  }

  const chunks: string[] = [];
  let current = '';
  let currentLen = 0;

  const paragraphs = content.split(/\n\n+/);

  for (const raw of paragraphs) {
    const para = raw.trim();
    if (!para) continue;

    const paraLen = segLen(para);

    if (currentLen > 0 && currentLen + paraLen + 2 > chunkSize) {
      chunks.push(current);
      current = '';
      currentLen = 0;
    }

    if (paraLen > chunkSize) {
      if (current) {
        chunks.push(current);
        current = '';
        currentLen = 0;
      }
      chunks.push(...splitLongText(para, chunkSize));
    } else {
      currentLen = currentLen > 0 ? currentLen + 2 + paraLen : paraLen;
      current = current ? current + '\n\n' + para : para;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

/**
 * Splits text into pieces of at most `chunkSize` graphemes, preferring to cut after sentence-ending
 * punctuation in the second half of each piece. The text is segmented once and walked with an index, so
 * the cost is linear in its length.
 */
function splitLongText(text: string, chunkSize: number): string[] {
  const runes = segArray(text);
  const chunks: string[] = [];
  let start = 0;

  while (runes.length - start > chunkSize) {
    let cut = start + chunkSize;
    // search backwards for sentence boundary
    for (let i = start + chunkSize; i > start + chunkSize / 2; i--) {
      const r = runes[i];
      if (r === '.' || r === '!' || r === '?' || r === '\n' || r === '。') {
        cut = i + 1;
        break;
      }
    }
    chunks.push(runes.slice(start, cut).join('').trim());
    start = cut;
    while (start < runes.length && (runes[start] ?? '').trim() === '') start++;
  }

  if (start < runes.length) chunks.push(runes.slice(start).join('').trim());
  return chunks;
}

// ─── Heading-aware chunking ─────────────────────────────────────────────────

type BlockKind = 'prose' | 'code' | 'table';

interface Block {
  text: string;
  startLine: number;
  endLine: number;
  kind: BlockKind;
}

/** A chunk plus whether it is a whole section (as opposed to a piece of a split section). */
interface Entry {
  chunk: MarkdownChunk;
  whole: boolean;
}

/** Splits a section into blank-line separated blocks; fenced code and tables are atomic blocks. */
function toBlocks(section: DocumentSection): Block[] {
  const lines = section.text.split('\n');
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let bufferStart = 0;
  let bufferKind: 'prose' | 'table' = 'prose';

  const flush = (): void => {
    if (buffer.length === 0) return;
    blocks.push({
      text: buffer.join('\n'),
      startLine: section.startLine + bufferStart,
      endLine: section.startLine + bufferStart + buffer.length - 1,
      kind: bufferKind,
    });
    buffer = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const fence = matchFenceOpen(line);
    if (fence) {
      flush();
      let end = i + 1;
      while (end < lines.length && !isFenceClose(lines[end] ?? '', fence)) end++;
      const last = Math.min(end, lines.length - 1);
      blocks.push({
        text: lines.slice(i, last + 1).join('\n'),
        startLine: section.startLine + i,
        endLine: section.startLine + last,
        kind: 'code',
      });
      i = last + 1;
      continue;
    }
    if (line.trim() === '') {
      flush();
      i++;
      continue;
    }
    const kind = line.trimStart().startsWith('|') ? 'table' : 'prose';
    if (buffer.length > 0 && bufferKind !== kind) flush();
    if (buffer.length === 0) {
      bufferStart = i;
      bufferKind = kind;
    }
    buffer.push(line);
    i++;
  }
  flush();
  return blocks;
}

/** Greedily packs lines into pieces of at most `limit` graphemes (a single longer line stays whole). */
function packLines(lines: string[], firstLine: number, limit: number, kind: BlockKind): Block[] {
  const pieces: Block[] = [];
  let current: string[] = [];
  let currentLen = 0;
  let start = 0;

  const emit = (): void => {
    if (current.length === 0) return;
    pieces.push({
      text: current.join('\n'),
      startLine: firstLine + start,
      endLine: firstLine + start + current.length - 1,
      kind,
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const len = segLen(line, limit);
    if (current.length === 0) {
      start = i;
      current = [line];
      currentLen = len;
    } else if (currentLen + 1 + len > limit) {
      emit();
      start = i;
      current = [line];
      currentLen = len;
    } else {
      current.push(line);
      currentLen += 1 + len;
    }
  }
  emit();
  return pieces;
}

/** Splits a block that is larger than chunkSize into blocks that each fit (where possible). */
function splitBlock(block: Block, chunkSize: number): Block[] {
  if (segLen(block.text, chunkSize) <= chunkSize) return [block];

  const lines = block.text.split('\n');

  if (block.kind === 'prose') {
    // Pack whole lines first so every piece keeps accurate line numbers; only a single line that is
    // itself too long is cut by sentence/length, and then all of its pieces share that one line.
    return packLines(lines, block.startLine, chunkSize, 'prose').flatMap((piece) =>
      segLen(piece.text, chunkSize) <= chunkSize
        ? [piece]
        : splitLongText(piece.text, chunkSize).map((text) => ({ ...piece, text })),
    );
  }

  if (block.kind === 'table') {
    return packLines(lines, block.startLine, chunkSize, 'table');
  }

  // Fenced code: split the body on line boundaries and re-wrap each piece in the original fence.
  const open = lines[0] ?? '';
  const fence = matchFenceOpen(open);
  const lastLine = lines[lines.length - 1] ?? '';
  const hasClose = fence !== null && lines.length > 1 && isFenceClose(lastLine, fence);
  const close = hasClose ? lastLine : (fence ? fence.char.repeat(fence.len) : '```');
  const inner = hasClose ? lines.slice(1, -1) : lines.slice(1);
  const overhead = segLen(open) + segLen(close) + 2;
  const pieces = packLines(inner, block.startLine + 1, Math.max(1, chunkSize - overhead), 'code');
  return pieces.map((piece) => ({ ...piece, text: `${open}\n${piece.text}\n${close}` }));
}

function commonPrefix(a: string[], b: string[]): string[] {
  const prefix: string[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) break;
    prefix.push(a[i] ?? '');
  }
  return prefix;
}

function canMerge(a: Entry, b: Entry, tinyLimit: number, chunkSize: number): boolean {
  if (!a.whole || !b.whole) return false;
  const pathA = a.chunk.headingPath ?? [];
  const pathB = b.chunk.headingPath ?? [];
  // Only merge sections that sit under the same top-level heading.
  if (pathA.length === 0 || pathB.length === 0 || pathA[0] !== pathB[0]) return false;
  const lenA = segLen(a.chunk.content, tinyLimit);
  if (lenA >= tinyLimit) return false;
  return lenA + 2 + segLen(b.chunk.content, chunkSize) <= chunkSize;
}

function mergeEntries(a: Entry, b: Entry): Entry {
  return {
    whole: true,
    chunk: {
      content: `${a.chunk.content}\n\n${b.chunk.content}`,
      position: a.chunk.position,
      headingPath: commonPrefix(a.chunk.headingPath ?? [], b.chunk.headingPath ?? []),
      startLine: a.chunk.startLine,
      endLine: b.chunk.endLine,
    },
  };
}

/**
 * Merges runs of tiny whole-section chunks (shorter than a quarter of `chunkSize`) with the following
 * whole-section chunk when they share a top-level heading and the result still fits.
 */
function mergeTinyChunks(entries: Entry[], chunkSize: number): MarkdownChunk[] {
  const tinyLimit = Math.ceil(chunkSize / 4);
  const merged: Entry[] = [];
  for (const entry of entries) {
    const previous = merged[merged.length - 1];
    if (previous && canMerge(previous, entry, tinyLimit, chunkSize)) {
      merged[merged.length - 1] = mergeEntries(previous, entry);
    } else {
      merged.push(entry);
    }
  }
  return merged.map((entry, position) => ({ ...entry.chunk, position }));
}

/**
 * Turns loader sections into embeddable chunks. A section that fits becomes one chunk; a larger one
 * is split into paragraph/fence/table blocks that are packed greedily up to `chunkSize` graphemes.
 * Tiny neighbouring sections are then merged (see mergeTinyChunks).
 */
export function chunkSections(sections: DocumentSection[], chunkSize: number): MarkdownChunk[] {
  const entries: Entry[] = [];

  for (const section of sections) {
    if (segLen(section.text, chunkSize) <= chunkSize) {
      entries.push({
        whole: true,
        chunk: {
          content: section.text,
          position: entries.length,
          headingPath: [...section.headingPath],
          startLine: section.startLine,
          endLine: section.endLine,
        },
      });
      continue;
    }

    let group: Block[] = [];
    let groupLen = 0;

    const emit = (): void => {
      const first = group[0];
      const last = group[group.length - 1];
      if (!first || !last) return;
      entries.push({
        whole: false,
        chunk: {
          content: group.map((block) => block.text).join('\n\n'),
          position: entries.length,
          headingPath: [...section.headingPath],
          startLine: first.startLine,
          endLine: last.endLine,
        },
      });
      group = [];
      groupLen = 0;
    };

    for (const block of toBlocks(section).flatMap((b) => splitBlock(b, chunkSize))) {
      const len = segLen(block.text, chunkSize);
      if (group.length > 0 && groupLen + 2 + len > chunkSize) emit();
      groupLen = group.length === 0 ? len : groupLen + 2 + len;
      group.push(block);
    }
    emit();
  }

  return mergeTinyChunks(entries, chunkSize);
}
