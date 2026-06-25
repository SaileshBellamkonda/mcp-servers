import { readFileSync } from 'node:fs';
import type { MarkdownChunk } from '../core/types.js';

const segmenter = new Intl.Segmenter();

function segLen(str: string): number {
  return [...segmenter.segment(str)].length;
}

function segArray(str: string): string[] {
  return [...segmenter.segment(str)].map(s => s.segment);
}

export function parseMarkdownFile(filePath: string, chunkSize: number): MarkdownChunk[] {
  const content = readFileSync(filePath, 'utf8');
  const texts = splitIntoChunks(content, chunkSize);
  return texts.map((text, i) => ({ content: text, position: i }));
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
