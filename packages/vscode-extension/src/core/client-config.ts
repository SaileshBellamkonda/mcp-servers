/**
 * Everything that turns running servers into configuration for MCP clients (Claude Code's `.mcp.json`, its
 * `claude mcp add-json` command, a generic client config). None of it ever receives a token: entries only carry
 * a `headersHelper` command line that makes the client ask the helper script for the `Authorization` header.
 */

/** An HTTP server entry of a client configuration. */
export interface ClientServerEntry {
  type: 'http';
  url: string;
  headersHelper: string;
}

export type ShellPlatform = 'win32' | NodeJS.Platform;

const SCOPE_KEY = /^[0-9a-f]{16}$/;
// eslint-disable-next-line no-control-regex -- control characters cannot be quoted portably
const CONTROL = /[\u0000-\u001f\u007f]/;

function assertNoControl(arg: string): void {
  if (CONTROL.test(arg)) throw new Error('Cannot quote an argument that contains control characters');
}

/** Quotes one argument for a POSIX shell: single quotes, with `'` written as `'\''`. */
export function quotePosix(arg: string): string {
  assertNoControl(arg);
  return `'${arg.replaceAll("'", "'\\''")}'`;
}

/**
 * Quotes one argument for Windows (`CommandLineToArgvW` rules: backslashes before a quote and before the closing
 * quote are doubled, a quote becomes `\"`). `%` is refused: cmd.exe expands `%VAR%` even inside double quotes and
 * it cannot be escaped there.
 */
export function quoteWindows(arg: string): string {
  assertNoControl(arg);
  if (arg.includes('%')) throw new Error('Cannot quote an argument that contains "%" for the Windows command line');
  let out = '';
  let backslashes = 0;
  for (const char of arg) {
    if (char === '\\') {
      backslashes++;
    } else if (char === '"') {
      out += `${'\\'.repeat(backslashes * 2 + 1)}"`;
      backslashes = 0;
    } else {
      out += '\\'.repeat(backslashes) + char;
      backslashes = 0;
    }
  }
  return `"${out}${'\\'.repeat(backslashes * 2)}"`;
}

function quoteFor(platform: ShellPlatform, arg: string): string {
  return platform === 'win32' ? quoteWindows(arg) : quotePosix(arg);
}

/** The name of the entry for a server in a client's configuration. */
export function clientServerName(serverId: string): string {
  return `vscode-${serverId}`;
}

/**
 * The shell command a client runs to obtain the headers: `node "<helper>" "<scopeKey>" --dir "<tokens dir>"`.
 * On Windows the paths use forward slashes, which `node` accepts and which are valid in cmd.exe, PowerShell and
 * Git Bash alike (a backslash path would be mangled by Git Bash).
 */
export function buildHeadersHelperCommand(options: {
  platform: ShellPlatform;
  helperPath: string;
  scopeKey: string;
  tokensDir: string;
}): string {
  const { platform, scopeKey } = options;
  if (!SCOPE_KEY.test(scopeKey)) throw new Error('Invalid workspace scope key (expected 16 lowercase hex characters)');
  const path = (value: string): string => (platform === 'win32' ? value.replaceAll('\\', '/') : value);
  return ['node', quoteFor(platform, path(options.helperPath)), quoteFor(platform, scopeKey), '--dir', quoteFor(platform, path(options.tokensDir))].join(' ');
}

export function buildServerEntry(url: string, headersHelper: string): ClientServerEntry {
  return { type: 'http', url, headersHelper };
}

/** `{ "mcpServers": { ... } }`, the shape most MCP clients accept. */
export function buildClientConfig(entries: Readonly<Record<string, ClientServerEntry>>): string {
  return JSON.stringify({ mcpServers: entries }, null, 2);
}

/** One `claude mcp add-json --scope local <name> '<json>'` command per entry, one per line. */
export function buildAddJsonCommands(platform: ShellPlatform, entries: Readonly<Record<string, ClientServerEntry>>): string {
  return Object.entries(entries)
    .map(([name, entry]) => `claude mcp add-json --scope local ${name} ${quoteFor(platform, JSON.stringify(entry))}`)
    .join('\n');
}

export type MergeResult = { ok: true; text: string; replaced: string[] } | { ok: false; error: string };

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merges `entries` into the text of an existing `.mcp.json` (or creates it): other servers and keys are kept,
 * formatting is normalised to two-space JSON in the file's own line-ending style. An existing file that is not a
 * JSON object, or whose `mcpServers` is not an object, is refused with an explanation instead of being rewritten.
 */
export function mergeMcpJson(existing: string | undefined, entries: Readonly<Record<string, ClientServerEntry>>): MergeResult {
  let root: Record<string, unknown> = {};
  let eol = '\n';
  if (existing !== undefined && stripBom(existing).trim() !== '') {
    if (existing.includes('\r\n')) eol = '\r\n';
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripBom(existing));
    } catch (error) {
      return { ok: false, error: `.mcp.json is not valid JSON (${error instanceof Error ? error.message : String(error)}); fix or remove it and try again. Nothing was changed.` };
    }
    if (!isPlainObject(parsed)) return { ok: false, error: '.mcp.json must contain a JSON object at the top level. Nothing was changed.' };
    root = parsed;
  }
  const current = root['mcpServers'];
  if (current !== undefined && !isPlainObject(current)) {
    return { ok: false, error: 'The "mcpServers" entry of .mcp.json is not an object. Nothing was changed.' };
  }
  const servers: Record<string, unknown> = { ...(current ?? {}) };
  const replaced = Object.keys(entries).filter((name) => Object.hasOwn(servers, name));
  Object.assign(servers, entries);
  const text = `${JSON.stringify({ ...root, mcpServers: servers }, null, 2)}\n`;
  return { ok: true, text: eol === '\n' ? text : text.replaceAll('\n', eol), replaced };
}
