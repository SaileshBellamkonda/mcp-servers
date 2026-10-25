export interface Fence {
  char: string;
  len: number;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** Returns the fence opened by this line, or null if the line does not open one. */
export function matchFenceOpen(line: string): Fence | null {
  const match = FENCE_OPEN.exec(line);
  if (!match) return null;
  const marker = match[1] ?? '';
  const info = match[2] ?? '';
  const char = marker.charAt(0);
  // A backtick fence's info string may not contain a backtick (that would be inline code).
  if (char === '`' && info.includes('`')) return null;
  return { char, len: marker.length };
}

/** True when this line closes the given fence. */
export function isFenceClose(line: string, fence: Fence): boolean {
  const match = FENCE_CLOSE.exec(line);
  if (!match) return false;
  const marker = match[1] ?? '';
  return marker.startsWith(fence.char) && marker.length >= fence.len;
}
