import type { MarkdownChunk } from '../core/types.js';
import type { DocumentSection } from './loaders/types.js';
import { isFenceClose, matchFenceOpen } from './loaders/fence.js';

const segmenter = new Intl.Segmenter();

function segLen(str: string): number {
  return [...segmenter.segment(str)].length;
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
      chunks.push(...splitLargeParagraph(para, chunkSize));
    } else {
      current = currentLen > 0 ? current + '\n\n' + para : para;
      currentLen = segLen(current);
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function splitLargeParagraph(para: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  let runes = segArray(para);

  while (runes.length > chunkSize) {
    let cut = chunkSize;
    // search backwards for sentence boundary
    for (let i = chunkSize; i > chunkSize / 2; i--) {
      const r = runes[i];
      if (r === '.' || r === '!' || r === '?' || r === '\n' || r === '。') {
        cut = i + 1;
        break;
      }
    }
    if (cut > runes.length) cut = runes.length;
    chunks.push(runes.slice(0, cut).join('').trim());
    runes = segArray(runes.slice(cut).join('').trim());
  }

  if (runes.length > 0) chunks.push(runes.join(''));
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
    const len = segLen(line);
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
  if (segLen(block.text) <= chunkSize) return [block];

  if (block.kind === 'prose') {
    return splitLargeParagraph(block.text, chunkSize).map((text) => ({ ...block, text }));
  }

  const lines = block.text.split('\n');
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

/**
 * Turns loader sections into embeddable chunks. A section that fits becomes one chunk; a larger one
 * is split into paragraph/fence/table blocks that are packed greedily up to `chunkSize` graphemes.
 */
export function chunkSections(sections: DocumentSection[], chunkSize: number): MarkdownChunk[] {
  const chunks: MarkdownChunk[] = [];

  for (const section of sections) {
    if (segLen(section.text) <= chunkSize) {
      chunks.push({
        content: section.text,
        position: chunks.length,
        headingPath: [...section.headingPath],
        startLine: section.startLine,
        endLine: section.endLine,
      });
      continue;
    }

    let group: Block[] = [];
    let groupLen = 0;

    const emit = (): void => {
      const first = group[0];
      const last = group[group.length - 1];
      if (!first || !last) return;
      chunks.push({
        content: group.map((block) => block.text).join('\n\n'),
        position: chunks.length,
        headingPath: [...section.headingPath],
        startLine: first.startLine,
        endLine: last.endLine,
      });
      group = [];
      groupLen = 0;
    };

    for (const block of toBlocks(section).flatMap((b) => splitBlock(b, chunkSize))) {
      const len = segLen(block.text);
      if (group.length > 0 && groupLen + 2 + len > chunkSize) emit();
      groupLen = group.length === 0 ? len : groupLen + 2 + len;
      group.push(block);
    }
    emit();
  }

  return chunks;
}
