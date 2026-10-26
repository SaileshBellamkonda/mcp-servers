import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  CODERAG_API_KEY_SECRET,
  COMMAND_ADD_TO_CLAUDE_CODE,
  COMMAND_CLEAR_API_KEY,
  COMMAND_ROTATE_TOKEN,
  COMMAND_SET_API_KEY,
  registerIntegrationCommands,
} from '../../src/integration-commands';
import { FailureReporter } from '../../src/commands';
import { deriveServerToken } from '../../src/core/server-token';
import { SecretStorageTokenProvider, tokenSecretKey } from '../../src/core/token-provider';
import { makeRegistry } from './fake-servers';
import { MemorySecrets } from './test-context';

type Handler = (arg?: unknown) => Promise<void>;
const SCOPE = 'abcdef0123456789';

interface Fixture {
  root: string;
  workspace: string;
  tokensDir: string;
  helperPath: string;
  secrets: MemorySecrets;
  tokens: SecretStorageTokenProvider;
  /** The git server's own token. */
  token: string;
  /** The workspace token the server tokens derive from: it must never reach a server, a client config or the UI. */
  workspaceToken: string;
  onApiKeyChanged: ReturnType<typeof vi.fn>;
  notifyChanged: ReturnType<typeof vi.fn>;
  run(id: string, arg?: unknown): Promise<void>;
  servers: Awaited<ReturnType<typeof makeRegistry>>['servers'];
  mcpJson(): string | undefined;
}

const quickPick = vi.mocked(vscode.window.showQuickPick) as unknown as ReturnType<typeof vi.fn>;
const warning = vi.mocked(vscode.window.showWarningMessage) as unknown as ReturnType<typeof vi.fn>;
const info = vi.mocked(vscode.window.showInformationMessage) as unknown as ReturnType<typeof vi.fn>;
const error = vi.mocked(vscode.window.showErrorMessage) as unknown as ReturnType<typeof vi.fn>;
const input = vi.mocked(vscode.window.showInputBox) as unknown as ReturnType<typeof vi.fn>;
const clipboard = vi.mocked(vscode.env.clipboard.writeText);

async function setup(
  specs: Parameters<typeof makeRegistry>[0] = [['git', 'running', 3000], ['coderag', 'running', 3100]],
  options: { workspace?: boolean; helper?: boolean; platform?: NodeJS.Platform } = {}
): Promise<Fixture> {
  const root = mkdtempSync(path.join(tmpdir(), 'integration-'));
  const workspace = path.join(root, 'my workspace');
  mkdirSync(workspace);
  const tokensDir = path.join(root, 'globalStorage', 'tokens');
  const helperPath = path.join(root, 'globalStorage', 'bin', 'mcp-headers.js');
  if (options.helper !== false) {
    mkdirSync(path.dirname(helperPath), { recursive: true });
    writeFileSync(helperPath, '// helper');
  }
  const secrets = new MemorySecrets();
  const tokens = new SecretStorageTokenProvider(secrets, tokensDir);
  const token = await tokens.getToken('git', SCOPE);
  const workspaceToken = secrets.values.get(tokenSecretKey(SCOPE)) ?? '';
  const made = await makeRegistry(specs);
  const onApiKeyChanged = vi.fn();
  const notifyChanged = vi.fn();
  vi.mocked(vscode.commands.registerCommand).mockClear();
  registerIntegrationCommands({
    registry: made.registry,
    reporter: new FailureReporter(),
    secrets,
    tokens,
    scopeKey: () => SCOPE,
    helperPath,
    firstWorkspaceFolder: () => (options.workspace === false ? undefined : workspace),
    onApiKeyChanged,
    notifyDefinitionsChanged: notifyChanged,
    platform: options.platform ?? process.platform,
  });
  const handlers = new Map<string, Handler>();
  for (const [id, handler] of vi.mocked(vscode.commands.registerCommand).mock.calls) handlers.set(id, handler as Handler);
  return {
    root,
    workspace,
    tokensDir,
    helperPath,
    secrets,
    tokens,
    token,
    workspaceToken,
    onApiKeyChanged,
    notifyChanged,
    servers: made.servers,
    run: (id, arg) => handlers.get(id)?.(arg) ?? Promise.reject(new Error(`no handler ${id}`)),
    mcpJson: () => {
      const file = path.join(workspace, '.mcp.json');
      return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
    },
  };
}

/** The user picks these servers (by id), then this action. */
function pick(servers: string[] | undefined, action?: 'write' | 'command' | 'config'): void {
  quickPick.mockImplementationOnce((items: { id?: string }[]) => Promise.resolve(servers === undefined ? undefined : items.filter((item) => servers.includes(item.id ?? ''))));
  if (action !== undefined) {
    quickPick.mockImplementationOnce((items: { action?: string }[]) => Promise.resolve(items.find((item) => item.action === action)));
  }
}

let fixture: Fixture | undefined;
beforeEach(() => {
  quickPick.mockReset();
  warning.mockReset();
  info.mockReset();
  error.mockReset();
  input.mockReset();
  clipboard.mockClear();
});
afterEach(() => {
  if (fixture) rmSync(fixture.root, { recursive: true, force: true });
  fixture = undefined;
});

function allUiText(): string {
  return JSON.stringify([warning.mock.calls, info.mock.calls, error.mock.calls, clipboard.mock.calls, input.mock.calls]);
}

describe('registerIntegrationCommands', () => {
  it('registers the four commands and returns their disposables', async () => {
    fixture = await setup();
    const ids = vi.mocked(vscode.commands.registerCommand).mock.calls.map(([id]) => id).sort();
    expect(ids).toEqual([COMMAND_ADD_TO_CLAUDE_CODE, COMMAND_CLEAR_API_KEY, COMMAND_ROTATE_TOKEN, COMMAND_SET_API_KEY].sort());
    expect(COMMAND_ADD_TO_CLAUDE_CODE).toBe('mcpServers.addToClaudeCode');
    expect(COMMAND_ROTATE_TOKEN).toBe('mcpServers.rotateToken');
    expect(COMMAND_SET_API_KEY).toBe('mcpServers.coderag.setApiKey');
    expect(COMMAND_CLEAR_API_KEY).toBe('mcpServers.coderag.clearApiKey');
  });
});

describe('CodeRAG API key commands', () => {
  it('stores the trimmed key in SecretStorage from a password-masked box and tells the coderag server to restart', async () => {
    fixture = await setup();
    input.mockResolvedValueOnce('  sk-the-secret-key  ');
    await fixture.run(COMMAND_SET_API_KEY);
    const options = input.mock.calls[0]?.[0] as { password?: boolean; ignoreFocusOut?: boolean; prompt?: string };
    expect(options.password).toBe(true);
    expect(options.ignoreFocusOut).toBe(true);
    expect(fixture.secrets.values.get(CODERAG_API_KEY_SECRET)).toBe('sk-the-secret-key');
    expect(CODERAG_API_KEY_SECRET).toMatch(/^mcpServers\.coderag\./);
    expect(fixture.onApiKeyChanged).toHaveBeenCalledOnce();
  });

  it('never shows or copies the key', async () => {
    fixture = await setup();
    input.mockResolvedValueOnce('sk-the-secret-key');
    await fixture.run(COMMAND_SET_API_KEY);
    expect(info).toHaveBeenCalled();
    expect(allUiText()).not.toContain('sk-the-secret-key');
  });

  it('validates that something was entered', async () => {
    fixture = await setup();
    input.mockResolvedValueOnce(undefined);
    await fixture.run(COMMAND_SET_API_KEY);
    const validate = (input.mock.calls[0]?.[0] as { validateInput: (value: string) => string | undefined }).validateInput;
    expect(validate('')).toMatch(/enter/i);
    expect(validate('   ')).toMatch(/enter/i);
    expect(validate('x')).toBeUndefined();
  });

  it('changes nothing when the box is cancelled or left empty', async () => {
    fixture = await setup();
    input.mockResolvedValueOnce(undefined);
    await fixture.run(COMMAND_SET_API_KEY);
    input.mockResolvedValueOnce('   ');
    await fixture.run(COMMAND_SET_API_KEY);
    expect(fixture.secrets.values.has(CODERAG_API_KEY_SECRET)).toBe(false);
    expect(fixture.onApiKeyChanged).not.toHaveBeenCalled();
  });

  it('clearApiKey deletes the secret and restarts the server', async () => {
    fixture = await setup();
    fixture.secrets.values.set(CODERAG_API_KEY_SECRET, 'sk-old');
    await fixture.run(COMMAND_CLEAR_API_KEY);
    expect(fixture.secrets.values.has(CODERAG_API_KEY_SECRET)).toBe(false);
    expect(fixture.onApiKeyChanged).toHaveBeenCalledOnce();
    expect(allUiText()).not.toContain('sk-old');
  });
});

describe('mcpServers.rotateToken', () => {
  it('asks for a modal confirmation that explains what breaks, and does nothing when declined', async () => {
    fixture = await setup();
    warning.mockResolvedValueOnce(undefined);
    await fixture.run(COMMAND_ROTATE_TOKEN);
    const [message, options, ...buttons] = warning.mock.calls[0] as [string, { modal?: boolean; detail?: string }, ...string[]];
    expect(options.modal).toBe(true);
    expect(`${message} ${options.detail ?? ''}`).toMatch(/static token/i);
    expect(`${message} ${options.detail ?? ''}`).toMatch(/headers helper|automatically/i);
    expect(buttons).toEqual(['Rotate']);
    expect(fixture.secrets.values.get(tokenSecretKey(SCOPE))).toBe(fixture.workspaceToken);
    expect(fixture.token).toBe(deriveServerToken(fixture.workspaceToken, 'git'));
    expect(fixture.servers['git']?.activate).toHaveBeenCalledOnce();
    expect(fixture.notifyChanged).not.toHaveBeenCalled();
  });

  it('rotates: new secret and file, running servers restarted with it, stopped ones untouched, VS Code told', async () => {
    fixture = await setup([['git', 'running', 3000], ['coderag', 'stopped', 3100]]);
    warning.mockResolvedValueOnce('Rotate');
    await fixture.run(COMMAND_ROTATE_TOKEN);
    const rotated = fixture.secrets.values.get(tokenSecretKey(SCOPE));
    expect(rotated).toMatch(/^[0-9a-f]{64}$/);
    expect(rotated).not.toBe(fixture.workspaceToken);
    expect((JSON.parse(readFileSync(path.join(fixture.tokensDir, `${SCOPE}.json`), 'utf8')) as { token: string }).token).toBe(rotated);
    expect(fixture.servers['git']?.activate).toHaveBeenCalledTimes(2);
    expect(fixture.servers['coderag']?.activate).not.toHaveBeenCalled();
    expect(fixture.notifyChanged).toHaveBeenCalledWith({ newToken: true });
  });

  it('never shows the new or the old token', async () => {
    fixture = await setup();
    warning.mockResolvedValueOnce('Rotate');
    await fixture.run(COMMAND_ROTATE_TOKEN);
    const rotated = fixture.secrets.values.get(tokenSecretKey(SCOPE)) ?? '';
    expect(allUiText()).not.toContain(rotated);
    expect(allUiText()).not.toContain(fixture.token);
      expect(allUiText()).not.toContain(fixture.workspaceToken);
    expect(info).toHaveBeenCalled();
  });
});

describe('mcpServers.addToClaudeCode', () => {
  describe('write .mcp.json', () => {
    it('writes one entry per picked server with the URL and a headersHelper, and never the token', async () => {
      fixture = await setup();
      pick(['git', 'coderag'], 'write');
      warning.mockResolvedValueOnce('Write .mcp.json');
      await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
      const text = fixture.mcpJson() ?? '';
      const parsed = JSON.parse(text) as { mcpServers: Record<string, { type: string; url: string; headersHelper: string }> };
      expect(Object.keys(parsed.mcpServers).sort()).toEqual(['vscode-coderag', 'vscode-git']);
      expect(parsed.mcpServers['vscode-git']).toMatchObject({ type: 'http', url: 'http://127.0.0.1:3000/mcp' });
      expect(parsed.mcpServers['vscode-coderag']).toMatchObject({ type: 'http', url: 'http://127.0.0.1:3100/mcp' });
      const helper = parsed.mcpServers['vscode-git']?.headersHelper ?? '';
      expect(helper).toContain('mcp-headers.js');
      expect(helper).toContain(SCOPE);
      expect(helper).toContain(`--dir`);
      // One helper command per server: the server id selects which derived token the helper prints.
      expect(helper).toMatch(/ ["']abcdef0123456789["'] ["']git["'] --dir /);
      expect(parsed.mcpServers['vscode-coderag']?.headersHelper).toMatch(/ ["']abcdef0123456789["'] ["']coderag["'] --dir /);
      expect(helper).toContain(fixture.tokensDir.replaceAll('\\', '/'));
      expect(Object.keys(parsed.mcpServers['vscode-git'] ?? {}).sort()).toEqual(['headersHelper', 'type', 'url']);
      expect(text).not.toContain(fixture.token);
      expect(text).not.toContain(fixture.workspaceToken);
      expect(allUiText()).not.toContain(fixture.token);
      expect(allUiText()).not.toContain(fixture.workspaceToken);
    });

    it('lists only servers that can run, with their URLs, and offers all of them preselected', async () => {
      fixture = await setup([['git', 'running', 3000], ['coderag', 'unavailable', 3100], ['zero', 'running', 0]]);
      pick(undefined);
      await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
      const [items, options] = quickPick.mock.calls[0] as [{ id: string; picked: boolean; description: string }[], { canPickMany?: boolean }];
      expect(options.canPickMany).toBe(true);
      expect(items.map((item) => item.id)).toEqual(['git']);
      expect(items[0]).toMatchObject({ picked: true, description: 'http://127.0.0.1:3000/mcp' });
    });

    it('tells the user why a port-0 or unavailable server is not offered', async () => {
      fixture = await setup([['git', 'running', 3000], ['zero', 'running', 0], ['coderag', 'unavailable', 3100]]);
      pick(undefined);
      await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
      const [items] = quickPick.mock.calls[0] as [{ id: string }[]];
      expect(items.map((item) => item.id)).toEqual(['git']);
      expect(info.mock.calls.flat().join(' ')).toMatch(/fixed port/i);
    });

    it('merges into an existing .mcp.json, keeping other servers and keys', async () => {
      fixture = await setup();
      writeFileSync(path.join(fixture.workspace, '.mcp.json'), '{"mcpServers":{"mine":{"command":"x"}},"other":1}');
      pick(['git'], 'write');
      warning.mockResolvedValueOnce('Write .mcp.json');
      await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
      const parsed = JSON.parse(fixture.mcpJson() ?? '') as { mcpServers: Record<string, unknown>; other: number };
      expect(Object.keys(parsed.mcpServers).sort()).toEqual(['mine', 'vscode-git']);
      expect(parsed.mcpServers['mine']).toEqual({ command: 'x' });
      expect(parsed.other).toBe(1);
    });

    it('refuses an invalid .mcp.json, explains, and leaves the file as it was', async () => {
      fixture = await setup();
      const broken = '{ "mcpServers": ';
      writeFileSync(path.join(fixture.workspace, '.mcp.json'), broken);
      pick(['git'], 'write');
      await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
      expect(fixture.mcpJson()).toBe(broken);
      expect(error.mock.calls.flat().join(' ')).toMatch(/not valid JSON/);
      expect(warning).not.toHaveBeenCalled();
    });

    it('asks first (modal), warns about the machine-specific path, and writes nothing when declined', async () => {
      fixture = await setup();
      pick(['git'], 'write');
      warning.mockResolvedValueOnce(undefined);
      await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
      const [message, options] = warning.mock.calls[0] as [string, { modal?: boolean; detail?: string }];
      expect(options.modal).toBe(true);
      expect(`${message} ${options.detail ?? ''}`).toMatch(/machine-specific/i);
      expect(fixture.mcpJson()).toBeUndefined();
    });

    it('offers to exclude the file in a git repository and appends to .git/info/exclude only on consent', async () => {
      fixture = await setup();
      mkdirSync(path.join(fixture.workspace, '.git', 'info'), { recursive: true });
      writeFileSync(path.join(fixture.workspace, '.git', 'info', 'exclude'), '# comment\n*.log');
      pick(['git'], 'write');
      warning.mockResolvedValueOnce('Write and exclude from git');
      await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
      const buttons = (warning.mock.calls[0] as unknown[]).slice(2);
      expect(buttons).toEqual(['Write .mcp.json', 'Write and exclude from git']);
      expect(readFileSync(path.join(fixture.workspace, '.git', 'info', 'exclude'), 'utf8')).toBe('# comment\n*.log\n.mcp.json\n');
      expect(fixture.mcpJson()).toBeDefined();
    });

    it('does not touch .git/info/exclude when the user only writes the file, and never duplicates the entry', async () => {
      fixture = await setup();
      const exclude = path.join(fixture.workspace, '.git', 'info', 'exclude');
      mkdirSync(path.dirname(exclude), { recursive: true });
      writeFileSync(exclude, '/.mcp.json\n');
      pick(['git'], 'write');
      warning.mockResolvedValueOnce('Write .mcp.json');
      await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
      expect(readFileSync(exclude, 'utf8')).toBe('/.mcp.json\n');
      pick(['git'], 'write');
      warning.mockResolvedValueOnce('Write and exclude from git');
      await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
      expect(readFileSync(exclude, 'utf8')).toBe('/.mcp.json\n');
    });

    it.runIf(process.platform !== 'win32')('refuses a symlinked .mcp.json with a clear error and writes nothing, not even through the link', async () => {
      fixture = await setup();
      const target = path.join(fixture.root, 'elsewhere.json');
      writeFileSync(target, '{"mcpServers":{"mine":{"command":"x"}}}');
      symlinkSync(target, path.join(fixture.workspace, '.mcp.json'));
      pick(['git'], 'write');
      await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
      expect(error.mock.calls.flat().join(' ')).toMatch(/symbolic link/i);
      expect(warning).not.toHaveBeenCalled();
      expect(readFileSync(target, 'utf8')).toBe('{"mcpServers":{"mine":{"command":"x"}}}');
      expect(readdirSync(fixture.root)).not.toContain('.mcp.json');
    });

    it('writes .mcp.json through a temporary file (no leftovers in the folder)', async () => {
      fixture = await setup();
      pick(['git'], 'write');
      warning.mockResolvedValueOnce('Write .mcp.json');
      await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
      expect(readdirSync(fixture.workspace)).toEqual(['.mcp.json']);
    });

    it.runIf(process.platform !== 'win32')('does not offer to exclude through a symlinked .git, so nothing is written through it', async () => {
      fixture = await setup();
      const outside = path.join(fixture.root, 'outside-git');
      mkdirSync(path.join(outside, 'info'), { recursive: true });
      symlinkSync(outside, path.join(fixture.workspace, '.git'));
      pick(['git'], 'write');
      warning.mockResolvedValueOnce('Write .mcp.json');
      await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
      expect((warning.mock.calls[0] as unknown[]).slice(2)).toEqual(['Write .mcp.json']);
      expect(readdirSync(path.join(outside, 'info'))).toEqual([]);
    });

    it.runIf(process.platform !== 'win32')('reports a symlinked .git/info/exclude without writing through it, and says the file itself was written', async () => {
      fixture = await setup();
      const exclude = path.join(fixture.workspace, '.git', 'info', 'exclude');
      mkdirSync(path.dirname(exclude), { recursive: true });
      const target = path.join(fixture.root, 'precious');
      writeFileSync(target, 'keep\n');
      symlinkSync(target, exclude);
      pick(['git'], 'write');
      warning.mockResolvedValueOnce('Write and exclude from git');
      await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
      expect(readFileSync(target, 'utf8')).toBe('keep\n');
      expect(fixture.mcpJson()).toBeDefined();
      const text = error.mock.calls.flat().join(' ');
      expect(text).toMatch(/symbolic link/i);
      expect(text).toMatch(/\.mcp\.json was written/i);
    });

    it('offers only the plain write outside a git repository', async () => {
      fixture = await setup();
      pick(['git'], 'write');
      warning.mockResolvedValueOnce('Write .mcp.json');
      await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
      expect((warning.mock.calls[0] as unknown[]).slice(2)).toEqual(['Write .mcp.json']);
      expect(existsSync(path.join(fixture.workspace, '.git'))).toBe(false);
    });

    it('needs a workspace folder', async () => {
      fixture = await setup(undefined, { workspace: false });
      pick(['git'], 'write');
      await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
      expect(error.mock.calls.flat().join(' ')).toMatch(/open a folder/i);
    });

    it('refuses to write a config that would point at a helper that is not installed', async () => {
      fixture = await setup(undefined, { helper: false });
      pick(['git'], 'write');
      await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
      expect(error.mock.calls.flat().join(' ')).toMatch(/helper/i);
      expect(fixture.mcpJson()).toBeUndefined();
    });
  });

  describe('copy', () => {
    it('copies claude mcp add-json commands (local scope) without the token', async () => {
      fixture = await setup();
      pick(['git', 'coderag'], 'command');
      await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
      const text = String(clipboard.mock.calls[0]?.[0]);
      const lines = text.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/^claude mcp add-json --scope local vscode-git /);
      expect(lines[1]).toMatch(/^claude mcp add-json --scope local vscode-coderag /);
      expect(text).toContain('http://127.0.0.1:3100/mcp');
      expect(text).not.toContain(fixture.token);
      expect(text).not.toContain(fixture.workspaceToken);
      expect(allUiText()).not.toContain(fixture.token);
      expect(allUiText()).not.toContain(fixture.workspaceToken);
    });

    it('quotes for the Windows shell on win32', async () => {
      fixture = await setup(undefined, { platform: 'win32' });
      pick(['git'], 'command');
      await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
      const text = String(clipboard.mock.calls[0]?.[0]);
      expect(text).toMatch(/^claude mcp add-json --scope local vscode-git "\{/);
      expect(text).toContain('\\"headersHelper\\"');
    });

    it('copies the generic client config as JSON, without the token', async () => {
      fixture = await setup();
      pick(['git'], 'config');
      await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
      const text = String(clipboard.mock.calls[0]?.[0]);
      expect(JSON.parse(text)).toMatchObject({ mcpServers: { 'vscode-git': { type: 'http', url: 'http://127.0.0.1:3000/mcp' } } });
      expect(text).not.toContain(fixture.token);
      expect(text).not.toContain(fixture.workspaceToken);
    });
  });

  it('does nothing when the server pick or the action pick is cancelled', async () => {
    fixture = await setup();
    pick(undefined);
    await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
    pick([], 'write');
    await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
    pick(['git']);
    quickPick.mockResolvedValueOnce(undefined);
    await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
    expect(clipboard).not.toHaveBeenCalled();
    expect(fixture.mcpJson()).toBeUndefined();
  });

  it('offers only running servers: a stopped, starting or failed one is left out with a reason that says what to do', async () => {
    fixture = await setup([['git', 'running', 3000], ['coderag', 'stopped', 3100], ['files', 'starting', 3200], ['broken', 'error', 3300]]);
    pick(undefined);
    await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
    const [items] = quickPick.mock.calls[0] as [{ id: string }[]];
    expect(items.map((item) => item.id)).toEqual(['git']);
    const text = info.mock.calls.flat().join(' ');
    expect(text).toMatch(/CODERAG is not running/);
    expect(text).toMatch(/FILES is still starting/);
    expect(text).toMatch(/BROKEN failed to start/);
  });

  it('with no server running, explains that one has to be started and offers to show the servers', async () => {
    fixture = await setup([['git', 'stopped', 3000], ['coderag', 'error', 3100]]);
    info.mockResolvedValueOnce('Show MCP Servers');
    await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
    expect(quickPick).not.toHaveBeenCalled();
    const [message, ...buttons] = info.mock.calls[0] as string[];
    expect(message).toMatch(/no mcp server is running/i);
    expect(message).toMatch(/start/i);
    expect(buttons).toEqual(['Show MCP Servers']);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('mcpServers.focus');
    expect(fixture.mcpJson()).toBeUndefined();
  });

  it('says so when no server can be added', async () => {
    fixture = await setup([['coderag', 'unavailable', 3100]]);
    await fixture.run(COMMAND_ADD_TO_CLAUDE_CODE);
    expect(quickPick).not.toHaveBeenCalled();
    expect(info.mock.calls.flat().join(' ')).toMatch(/cannot run here|no server/i);
  });
});
