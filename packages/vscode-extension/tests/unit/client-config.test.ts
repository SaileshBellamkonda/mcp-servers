import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  buildAddJsonCommands,
  buildClientConfig,
  buildHeadersHelperCommand,
  buildServerEntry,
  clientServerName,
  mergeMcpJson,
  quotePosix,
  quoteWindows,
  type ClientServerEntry,
} from '../../src/core/client-config';

const gitEntry: ClientServerEntry = { type: 'http', url: 'http://127.0.0.1:3000/mcp', headersHelper: 'node helper' };
const ragEntry: ClientServerEntry = { type: 'http', url: 'http://127.0.0.1:3100/mcp', headersHelper: 'node helper' };

describe('quotePosix', () => {
  it('wraps in single quotes', () => {
    expect(quotePosix('/home/me/bin/mcp-headers.js')).toBe("'/home/me/bin/mcp-headers.js'");
  });

  it('keeps spaces and shell metacharacters literal', () => {
    expect(quotePosix('/home/my user/a b;rm -rf $HOME `x` "q" \\')).toBe("'/home/my user/a b;rm -rf $HOME `x` \"q\" \\'");
  });

  it("escapes single quotes as '\\''", () => {
    expect(quotePosix("it's")).toBe("'it'\\''s'");
  });

  it('round-trips through a real POSIX shell', () => {
    if (process.platform === 'win32') return;
    for (const value of ["plain", "with space", "it's \"mine\"", '$HOME `id` $(id) ;&|<>*?', 'back\\slash', '']) {
      const echoed = execFileSync('/bin/sh', ['-c', `printf %s ${quotePosix(value)}`], { encoding: 'utf8' });
      expect(echoed).toBe(value);
    }
  });

  it('refuses control characters', () => {
    expect(() => quotePosix('a\nb')).toThrow(/control/i);
    expect(() => quotePosix('a\u0000b')).toThrow(/control/i);
  });
});

describe('quoteWindows', () => {
  it('wraps in double quotes', () => {
    expect(quoteWindows('C:/Users/me/mcp-headers.js')).toBe('"C:/Users/me/mcp-headers.js"');
  });

  it('keeps spaces inside one argument', () => {
    expect(quoteWindows('C:\\Users\\my user\\bin')).toBe('"C:\\Users\\my user\\bin"');
  });

  it('escapes embedded double quotes with a backslash', () => {
    expect(quoteWindows('say "hi"')).toBe('"say \\"hi\\""');
  });

  it('doubles backslashes that precede a quote or the closing quote (CommandLineToArgvW rules)', () => {
    expect(quoteWindows('C:\\dir with space\\')).toBe('"C:\\dir with space\\\\"');
    expect(quoteWindows('a\\"b')).toBe('"a\\\\\\"b"');
  });

  it('refuses % (cmd.exe expands it even inside quotes) and control characters', () => {
    expect(() => quoteWindows('C:\\100%\\x')).toThrow(/%/);
    expect(() => quoteWindows('a\r\nb')).toThrow(/control/i);
  });
});

describe('buildHeadersHelperCommand', () => {
  const base = { scopeKey: 'abcdef0123456789', serverId: 'git' };

  it('POSIX: node, the script, the scope key and --dir, each quoted', () => {
    const command = buildHeadersHelperCommand({
      ...base,
      platform: 'linux',
      helperPath: '/home/my user/.config/Code/User/globalStorage/pub.mcp-servers/bin/mcp-headers.js',
      tokensDir: "/home/my user/.config/Code/User/globalStorage/pub.mcp-servers/tokens",
    });
    expect(command).toBe(
      "node '/home/my user/.config/Code/User/globalStorage/pub.mcp-servers/bin/mcp-headers.js' 'abcdef0123456789' 'git' --dir '/home/my user/.config/Code/User/globalStorage/pub.mcp-servers/tokens'"
    );
  });

  it('Windows: double quotes and forward slashes (valid for cmd.exe, PowerShell and Git Bash)', () => {
    const command = buildHeadersHelperCommand({
      ...base,
      platform: 'win32',
      helperPath: 'C:\\Users\\my user\\AppData\\Roaming\\Code\\User\\globalStorage\\pub.mcp-servers\\bin\\mcp-headers.js',
      tokensDir: 'C:\\Users\\my user\\AppData\\Roaming\\Code\\User\\globalStorage\\pub.mcp-servers\\tokens',
    });
    expect(command).toBe(
      'node "C:/Users/my user/AppData/Roaming/Code/User/globalStorage/pub.mcp-servers/bin/mcp-headers.js" "abcdef0123456789" "git" --dir "C:/Users/my user/AppData/Roaming/Code/User/globalStorage/pub.mcp-servers/tokens"'
    );
  });

  it('is run by a real shell and passes the arguments through intact (POSIX)', () => {
    if (process.platform === 'win32') return;
    const command = buildHeadersHelperCommand({ ...base, platform: 'linux', helperPath: "/tmp/dir with 'quote'/h.js", tokensDir: '/tmp/t d' });
    const argv = execFileSync('/bin/sh', ['-c', command.replace(/^node /, 'printf "%s\\n" ')], { encoding: 'utf8' }).split('\n').slice(0, 5);
    expect(argv).toEqual(["/tmp/dir with 'quote'/h.js", 'abcdef0123456789', 'git', '--dir', '/tmp/t d']);
  });

  it('rejects an invalid scope key', () => {
    expect(() => buildHeadersHelperCommand({ platform: 'linux', helperPath: '/h.js', tokensDir: '/t', scopeKey: '../x', serverId: 'git' })).toThrow(/scope/i);
  });

  it('rejects an invalid server id', () => {
    for (const serverId of ['', 'Git', '../x', 'a b']) {
      expect(() => buildHeadersHelperCommand({ ...base, serverId, platform: 'linux', helperPath: '/h.js', tokensDir: '/t' }), serverId).toThrow(/server id/i);
    }
  });
});

describe('server entries', () => {
  it('names the entries vscode-<id>', () => {
    expect(clientServerName('git')).toBe('vscode-git');
    expect(clientServerName('coderag')).toBe('vscode-coderag');
  });

  it('builds an http entry with the URL and the headers helper, and nothing else', () => {
    expect(buildServerEntry('http://127.0.0.1:3000/mcp', 'node h')).toEqual({ type: 'http', url: 'http://127.0.0.1:3000/mcp', headersHelper: 'node h' });
  });

  it('copies a client config that nests the entries under mcpServers', () => {
    const text = buildClientConfig({ 'vscode-git': gitEntry });
    expect(JSON.parse(text)).toEqual({ mcpServers: { 'vscode-git': gitEntry } });
    expect(text.endsWith('\n')).toBe(false);
  });
});

describe('buildAddJsonCommands', () => {
  it('POSIX: one command per server with the JSON in single quotes, local scope', () => {
    const text = buildAddJsonCommands('linux', { 'vscode-git': gitEntry });
    expect(text).toBe(`claude mcp add-json --scope local vscode-git ${quotePosix(JSON.stringify(gitEntry))}`);
  });

  it('Windows: the JSON in double quotes with escaped inner quotes', () => {
    const text = buildAddJsonCommands('win32', { 'vscode-git': gitEntry });
    expect(text).toBe(`claude mcp add-json --scope local vscode-git ${quoteWindows(JSON.stringify(gitEntry))}`);
  });

  it('separates several servers by newlines', () => {
    const lines = buildAddJsonCommands('linux', { 'vscode-git': gitEntry, 'vscode-coderag': ragEntry }).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('vscode-coderag');
  });

  it('the quoted JSON survives a real POSIX shell unchanged', () => {
    if (process.platform === 'win32') return;
    const entry = { ...gitEntry, headersHelper: "node '/tmp/a b/h.js' 'abcdef0123456789' 'git' --dir '/tmp/t'" };
    const text = buildAddJsonCommands('linux', { 'vscode-git': entry }).replace(/^claude mcp add-json --scope local vscode-git /, 'printf %s ');
    expect(JSON.parse(execFileSync('/bin/sh', ['-c', text], { encoding: 'utf8' }))).toEqual(entry);
  });
});

describe('mergeMcpJson', () => {
  const entries = { 'vscode-git': gitEntry, 'vscode-coderag': ragEntry };

  it('creates the file content when there is none', () => {
    const result = mergeMcpJson(undefined, entries);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && JSON.parse(result.text)).toEqual({ mcpServers: entries });
    expect(result.ok && result.text.endsWith('\n')).toBe(true);
  });

  it('treats an empty file like a missing one', () => {
    expect(mergeMcpJson('  \n', entries).ok).toBe(true);
  });

  it('preserves other servers, other keys and the other entries, whatever the original formatting', () => {
    const existing = '{"mcpServers":{"mine":{"command":"x","args":["a"]},"vscode-git":{"type":"http","url":"http://old"}},"extra":{"k":1}}';
    const result = mergeMcpJson(existing, entries);
    expect(result.ok && JSON.parse(result.text)).toEqual({
      mcpServers: { mine: { command: 'x', args: ['a'] }, 'vscode-git': gitEntry, 'vscode-coderag': ragEntry },
      extra: { k: 1 },
    });
    expect(result.ok && result.replaced).toEqual(['vscode-git']);
  });

  it('adds mcpServers when the file is an object without it', () => {
    const result = mergeMcpJson('{"other":true}', entries);
    expect(result.ok && JSON.parse(result.text)).toEqual({ other: true, mcpServers: entries });
  });

  it('keeps the CRLF line endings of the original file', () => {
    const result = mergeMcpJson('{\r\n  "mcpServers": {}\r\n}\r\n', entries);
    expect(result.ok && result.text).toContain('\r\n');
    expect(result.ok && result.text.replaceAll('\r\n', '')).not.toContain('\n');
  });

  it('accepts a UTF-8 byte order mark', () => {
    expect(mergeMcpJson('\uFEFF{"mcpServers":{}}', entries).ok).toBe(true);
  });

  it.each([
    ['invalid JSON', '{ "mcpServers": '],
    ['JSON with comments', '{ // c\n "mcpServers": {} }'],
    ['a JSON array', '[]'],
    ['a JSON string', '"x"'],
    ['null', 'null'],
    ['mcpServers that is not an object', '{"mcpServers": []}'],
  ])('refuses %s and explains why, without producing text', (_name, existing) => {
    const result = mergeMcpJson(existing, entries);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/\.mcp\.json/);
    expect(result).not.toHaveProperty('text');
  });
});
