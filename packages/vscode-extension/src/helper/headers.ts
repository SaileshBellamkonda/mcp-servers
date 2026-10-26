// Dependency-free: this file is also bundled, on its own, into dist/mcp-headers.js (a script Claude Code runs as a
// `headersHelper`). It may import nothing but Node built-ins.
import { join } from 'node:path';

const SCOPE_KEY = /^[0-9a-f]{16}$/;
const MIN_TOKEN_LENGTH = 32;
const TOKEN_SHAPE = /^[\x21-\x7e]+$/;
const USAGE = 'Usage: node mcp-headers.js <scopeKey> --dir <tokens directory>   (or set MCP_SERVERS_TOKENS_DIR)';

export type HeadersResult = { ok: true; stdout: string } | { ok: false; message: string };

function parseArguments(argv: readonly string[]): { scopeKey?: string; dir?: string; error?: string } {
  let scopeKey: string | undefined;
  let dir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--dir') {
      dir = argv[++i];
      if (dir === undefined) return { error: '--dir needs a value' };
    } else if (arg.startsWith('--dir=')) {
      dir = arg.slice('--dir='.length);
    } else if (arg.startsWith('-') || scopeKey !== undefined) {
      return { error: `unexpected argument "${arg}"` };
    } else {
      scopeKey = arg;
    }
  }
  return { ...(scopeKey !== undefined && { scopeKey }), ...(dir !== undefined && { dir }) };
}

/**
 * Computes what the helper prints: the `Authorization` header JSON for the workspace `scopeKey`, read from
 * `<dir>/<scopeKey>.json`. `readFile` is injected for tests. A failure message never contains token material.
 */
export function computeHeaders(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  readFile: (file: string) => string
): HeadersResult {
  const parsed = parseArguments(argv);
  if (parsed.error !== undefined) return { ok: false, message: `${parsed.error}. ${USAGE}` };
  const { scopeKey } = parsed;
  const dir = parsed.dir ?? env['MCP_SERVERS_TOKENS_DIR'];
  if (scopeKey === undefined) return { ok: false, message: `missing the workspace scope key. ${USAGE}` };
  if (!SCOPE_KEY.test(scopeKey)) return { ok: false, message: 'the workspace scope key must be 16 lowercase hex characters' };
  if (dir === undefined || dir === '') return { ok: false, message: `missing --dir. ${USAGE}` };

  const file = join(dir, `${scopeKey}.json`);
  let text: string;
  try {
    text = readFile(file);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `cannot read the token file (${reason}). Is VS Code open on this workspace with the MCP Servers extension? The file is created when a server first starts.` };
  }
  let token: unknown;
  try {
    token = (JSON.parse(text) as { token?: unknown } | null)?.token;
  } catch {
    return { ok: false, message: `${file} is not valid JSON; restart the MCP Servers extension to rewrite it` };
  }
  if (typeof token !== 'string' || token.length < MIN_TOKEN_LENGTH || !TOKEN_SHAPE.test(token)) {
    return { ok: false, message: `${file} does not contain a usable token; restart the MCP Servers extension to rewrite it` };
  }
  return { ok: true, stdout: `${JSON.stringify({ Authorization: `Bearer ${token}` })}\n` };
}
