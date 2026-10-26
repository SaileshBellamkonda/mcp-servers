'use strict';
// Runs the bundled extension / servers in whatever runtime executes this file (plain Node, or a VS Code binary
// with ELECTRON_RUN_AS_NODE=1) and prints one line: `SMOKE_RESULT <json>`. It uses nothing but Node built-ins, so
// it also works from outside the repository with an empty NODE_PATH. The vitest files interpret the result.
//
//   --mode servers   --entry <servers-entry.cjs> --native <dist/native>
//   --mode extension --bundle <dist/extension.js>
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const TOKEN = 'smoke-test-token-0123456789abcdef0123456789abcdef';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const result = {
  runtime: { node: process.versions.node, electron: process.versions.electron ?? null, sqlite: process.versions.sqlite ?? null, platform: process.platform, arch: process.arch },
  steps: {},
};

/** Runs one named step; records `ok` (with optional detail) or the error message, never throws. */
async function step(name, fn) {
  try {
    const detail = await fn();
    result.steps[name] = { ok: true, ...(detail === undefined ? {} : { detail }) };
    return true;
  } catch (error) {
    result.steps[name] = { ok: false, error: error instanceof Error ? error.message : String(error) };
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------------------------------------------------
// MCP over HTTP
// ---------------------------------------------------------------------------------------------------------------
async function rpc(port, body, { token, session } = {}) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  if (session !== undefined) {
    headers['mcp-session-id'] = session;
    headers['mcp-protocol-version'] = '2025-06-18';
  }
  const response = await fetch(`http://127.0.0.1:${String(port)}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await response.text();
  let message;
  for (const line of text.split('\n')) {
    const payload = line.startsWith('data:') ? line.slice(5).trim() : line.trim().startsWith('{') ? line.trim() : '';
    if (payload) {
      try {
        const parsed = JSON.parse(payload);
        if (parsed.id === body.id) message = parsed;
      } catch {
        /* not a JSON line */
      }
    }
  }
  return { status: response.status, session: response.headers.get('mcp-session-id') ?? undefined, message, text };
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bundle-smoke', version: '0.0.0' } },
};

/** initialize without / with a wrong / with the right token, then notifications/initialized. Returns the session. */
async function handshake(port) {
  const none = await rpc(port, INITIALIZE);
  assert(none.status === 401, `initialize without a token returned ${String(none.status)}, expected 401`);
  const wrong = await rpc(port, INITIALIZE, { token: `${TOKEN}x` });
  assert(wrong.status === 401, `initialize with a wrong token returned ${String(wrong.status)}, expected 401`);
  const ok = await rpc(port, INITIALIZE, { token: TOKEN });
  assert(ok.status === 200, `initialize with the token returned ${String(ok.status)}: ${ok.text.slice(0, 200)}`);
  assert(ok.session, 'initialize returned no mcp-session-id');
  await rpc(port, { jsonrpc: '2.0', method: 'notifications/initialized' }, { token: TOKEN, session: ok.session });
  return ok.session;
}

let nextId = 10;
async function callTool(port, session, name, args) {
  const response = await rpc(port, { jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }, { token: TOKEN, session });
  assert(response.status === 200 && response.message, `tools/call ${name} returned ${String(response.status)}: ${response.text.slice(0, 300)}`);
  assert(!response.message.error, `tools/call ${name} failed: ${JSON.stringify(response.message.error)}`);
  const text = response.message.result?.content?.map((c) => c.text ?? '').join('') ?? '';
  assert(!response.message.result?.isError, `${name} reported an error: ${text.slice(0, 300)}`);
  return text;
}

function silentLogger() {
  return { info() {}, warning() {}, error() {} };
}

// ---------------------------------------------------------------------------------------------------------------
// servers mode
// ---------------------------------------------------------------------------------------------------------------
async function runServers() {
  const entry = require(path.resolve(arg('entry')));
  const nativeDir = path.resolve(arg('native'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-smoke-'));
  try {
    await runGit(entry, work);
    await runCodeRag(entry, nativeDir, work);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function runGit(entry, work) {
  const repo = path.join(work, 'repo');
  fs.mkdirSync(repo);
  const git = (...args) => childProcess.execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: repo, stdio: 'ignore' });
  let instance;
  await step('git.setup', () => {
    git('init', '-q');
    git('commit', '-q', '--allow-empty', '-m', 'init');
    fs.writeFileSync(path.join(repo, 'untracked-file.txt'), 'x');
  });
  if (!(await step('git.start', async () => {
    instance = await entry.activateGitServer({ workspaceFolders: [repo], port: 0, authToken: TOKEN, logger: silentLogger() });
    assert(instance.host === '127.0.0.1' && instance.port > 0, `unexpected address ${instance.host}:${String(instance.port)}`);
    return { port: instance.port };
  }))) return;
  let session;
  if (await step('git.auth', async () => { session = await handshake(instance.port); })) {
    await step('git.status', async () => {
      const text = await callTool(instance.port, session, 'git_status', { repository: repo });
      assert(text.includes('untracked-file.txt'), `git_status did not list the untracked file: ${text.slice(0, 200)}`);
    });
  }
  await step('git.close', async () => {
    await instance.close();
    await new Promise((resolve, reject) => {
      const socket = require('node:net').connect(instance.port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); reject(new Error('port still accepting connections after close')); });
      socket.once('error', () => { resolve(); });
    });
  });
}

/** A minimal OpenAI-compatible embeddings endpoint on 127.0.0.1 returning deterministic 8-dimensional vectors. */
function startFakeEmbeddings() {
  const vector = (text) => {
    const v = new Array(8).fill(0);
    for (let i = 0; i < text.length; i++) v[i % 8] += text.charCodeAt(i) % 31;
    return v.map((n) => n + 1);
  };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}').input ?? [];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: input.map((text, index) => ({ index, embedding: vector(String(text)) })) }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => { resolve({ server, port: server.address().port }); });
  });
}

async function runCodeRag(entry, nativeDir, work) {
  await step('coderag.probe', () => {
    const probe = entry.probeSqliteSupport({ nativeModulesDir: nativeDir });
    result.probe = probe;
    return probe;
  });

  const embeddings = await startFakeEmbeddings();
  const workspace = path.join(work, 'workspace');
  fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
  const source = path.join(workspace, 'src', 'greeter.ts');
  fs.writeFileSync(source, 'export function hello(name: string): string {\n  return `hi ${name}`;\n}\n\nexport class Greeter {\n  greet(): number {\n    return 1;\n  }\n}\n');
  const settings = {
    embeddingUrl: `http://127.0.0.1:${String(embeddings.port)}/v1`,
    embeddingModel: 'fake-embedding',
    embeddingDim: 8,
    dbPath: path.join(work, 'coderag.db'),
  };

  let instance;
  try {
    if (!(await step('coderag.start', async () => {
      instance = await entry.activateCodeRagServer({
        vsCodeConfig: { get: (key) => settings[key] },
        workspaceFolders: [workspace],
        port: 0,
        authToken: TOKEN,
        nativeModulesDir: nativeDir,
        logger: silentLogger(),
      });
      return { port: instance.port };
    }))) return;

    let session;
    if (!(await step('coderag.auth', async () => { session = await handshake(instance.port); }))) return;
    // The startup sync that the first session triggers indexes the workspace; wait for it to finish.
    await step('coderag.status', async () => {
      let status;
      for (let attempt = 0; attempt < 100; attempt++) {
        status = JSON.parse(await callTool(instance.port, session, 'get_index_status', {}));
        if (!status.sync_in_progress && status.last_code_sync_at !== null) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert(status.last_code_sync_at !== null, `startup sync did not finish: ${JSON.stringify(status)}`);
      return { embeddingDim: status.embedding_dim, codeCount: status.code_count };
    });
    // Parsing a TypeScript file proves tree-sitter and its grammar load from the staged directory.
    await step('coderag.index_code', async () => {
      const text = await callTool(instance.port, session, 'index_code', { filepath: source, force: true });
      assert(text.includes('"success": true') || text.includes('"success":true'), `index_code did not succeed: ${text.slice(0, 300)}`);
      const status = JSON.parse(await callTool(instance.port, session, 'get_index_status', {}));
      assert(status.code_count >= 1, `no code documents after indexing (${JSON.stringify(status)})`);
    });
    // The vector search runs on sqlite-vec's vec0 table.
    await step('coderag.search', async () => {
      const text = await callTool(instance.port, session, 'search', { query: 'hello greeting function', mode: 'semantic' });
      assert(text.includes('greeter.ts'), `semantic search did not return the indexed file: ${text.slice(0, 300)}`);
    });
  } finally {
    await step('coderag.close', async () => { await instance?.close(); });
    embeddings.server.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// extension mode: load the CJS bundle with a stub `vscode` module
// ---------------------------------------------------------------------------------------------------------------
function createVscodeStub(state) {
  class EventEmitter {
    constructor() { this.listeners = []; this.event = (listener) => { this.listeners.push(listener); return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== listener); } }; }; }
    fire(data) { for (const listener of [...this.listeners]) listener(data); }
    dispose() { this.listeners = []; }
  }
  const settings = state.settings;
  const listenerList = () => {
    const listeners = [];
    return (listener) => { listeners.push(listener); return { dispose() { listeners.splice(listeners.indexOf(listener), 1); } }; };
  };
  return {
    EventEmitter,
    StatusBarAlignment: { Left: 1, Right: 2 },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    TreeItem: class { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } },
    ThemeColor: class { constructor(id) { this.id = id; } },
    ThemeIcon: class { constructor(id, color) { this.id = id; this.color = color; } },
    window: {
      createOutputChannel: () => ({ appendLine: (line) => { state.output.push(line); }, dispose() {} }),
      showErrorMessage: (message) => { state.errors.push(message); return Promise.resolve(undefined); },
      showWarningMessage: (message) => { state.warnings.push(message); return Promise.resolve(undefined); },
      showInformationMessage: () => Promise.resolve(undefined),
      showQuickPick: () => Promise.resolve(undefined),
      createStatusBarItem: () => ({ text: '', tooltip: '', command: undefined, show() {}, hide() {}, dispose() {} }),
      createTreeView: (_id, options) => { state.tree = options.treeDataProvider; return { dispose() {} }; },
    },
    workspace: {
      workspaceFolders: state.folders,
      getConfiguration: (section) => ({ get: (key, fallback) => (Object.hasOwn(settings, `${section}.${key}`) ? settings[`${section}.${key}`] : fallback) }),
      onDidChangeConfiguration: listenerList(),
      onDidChangeWorkspaceFolders: listenerList(),
    },
    commands: {
      registerCommand: (id, handler) => { state.commands.set(id, handler); return { dispose() { state.commands.delete(id); } }; },
      executeCommand: (id, ...args) => state.commands.get(id)?.(...args),
    },
    env: { clipboard: { writeText: (text) => { state.clipboard.push(text); return Promise.resolve(); } } },
  };
}

/** A port nothing listens on right now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = require('node:net').createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => { resolve(port); }); });
  });
}

function assertClosed(port, what) {
  return new Promise((resolve, reject) => {
    const socket = require('node:net').connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); reject(new Error(`port ${String(port)} still open ${what}`)); });
    socket.once('error', () => { resolve(); });
  });
}

async function waitFor(what, predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function runExtension() {
  const bundle = path.resolve(arg('bundle'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-smoke-ext-'));
  const repo = path.join(work, 'repo');
  fs.mkdirSync(repo);
  childProcess.execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'ignore' });
  const port = await freePort();
  const state = {
    settings: { 'mcpServers.git.port': port, 'mcpServers.git.autoStart': true },
    folders: [{ uri: { fsPath: repo, scheme: 'file' }, name: 'repo', index: 0 }],
    output: [], errors: [], warnings: [], commands: new Map(), clipboard: [], tree: undefined,
  };
  const stub = createVscodeStub(state);
  const treeState = () => {
    const [element] = state.tree.getChildren();
    return element ? state.tree.getTreeItem(element) : undefined;
  };

  // Resolve `vscode` to the stub for any module the bundle loads.
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    return request === 'vscode' ? stub : originalLoad.call(this, request, parent, isMain);
  };
  try {
    let extension;
    await step('extension.load', () => {
      extension = require(bundle);
      assert(typeof extension.activate === 'function', 'bundle does not export activate');
      assert(typeof extension.deactivate === 'function', 'bundle does not export deactivate');
    });
    if (!extension) return;
    const context = { subscriptions: [] };
    await step('extension.activate', () => {
      extension.activate(context);
      const commands = [...state.commands.keys()].sort();
      assert(commands.includes('mcpServers.startServer') && commands.includes('mcpServers.stopServer'), `commands registered: ${commands.join(', ')}`);
      assert(state.tree, 'no tree view was created');
      return { commands };
    });
    // autoStart is on and the workspace folder is a real git repository: the git server must come up by itself on
    // the configured port and refuse unauthenticated requests.
    await step('extension.autostart', async () => {
      const item = await waitFor('the git server to run', () => {
        const current = treeState();
        assert(current?.contextValue !== 'server.error', `git server failed: ${state.errors.join(' | ')} ${state.output.join(' | ')}`);
        return current?.contextValue === 'server.running' ? current : undefined;
      });
      assert(item.description === `running on port ${String(port)}`, `unexpected description: ${item.description}`);
      const unauthenticated = await rpc(port, INITIALIZE);
      assert(unauthenticated.status === 401, `unauthenticated initialize returned ${String(unauthenticated.status)}`);
      assert(state.errors.length === 0, `unexpected error messages: ${state.errors.join(' | ')}`);
    });
    await step('extension.copy_url', async () => {
      await state.commands.get('mcpServers.copyServerUrl')();
      assert(state.clipboard.at(-1) === `http://127.0.0.1:${String(port)}/mcp`, `clipboard: ${state.clipboard.join(' | ')}`);
    });
    // A port held by someone else must surface as one clear error from the awaited activation, and the server must
    // start once the port is free again.
    await step('extension.port_in_use', async () => {
      await state.commands.get('mcpServers.stopServer')();
      await assertClosed(port, 'after stopServer');
      const squatter = require('node:net').createServer();
      await new Promise((resolve, reject) => { squatter.once('error', reject); squatter.listen(port, '127.0.0.1', resolve); });
      try {
        await state.commands.get('mcpServers.startServer')();
        assert(treeState()?.contextValue === 'server.error', `expected server.error, got ${String(treeState()?.contextValue)}`);
        assert(state.errors.length === 1 && state.errors[0].includes(`Port ${String(port)} is already in use`), `error messages: ${state.errors.join(' | ')}`);
      } finally {
        await new Promise((resolve) => { squatter.close(resolve); });
      }
      await state.commands.get('mcpServers.startServer')();
      assert(treeState()?.contextValue === 'server.running', `expected server.running after retry, got ${String(treeState()?.contextValue)}`);
    });
    // VS Code calls deactivate(), then disposes the subscriptions.
    await step('extension.deactivate', async () => {
      await extension.deactivate();
      await assertClosed(port, 'after deactivate()');
      assert(treeState()?.contextValue === 'server.stopped', `expected server.stopped, got ${String(treeState()?.contextValue)}`);
    });
    await step('extension.dispose', () => {
      for (const disposable of context.subscriptions) disposable.dispose();
    });
  } finally {
    Module._load = originalLoad;
    fs.rmSync(work, { recursive: true, force: true });
  }
}

(async () => {
  const mode = arg('mode');
  try {
    if (mode === 'servers') await runServers();
    else if (mode === 'extension') await runExtension();
    else throw new Error(`unknown --mode ${String(mode)}`);
  } catch (error) {
    result.fatal = error instanceof Error ? error.stack : String(error);
  }
  process.stdout.write(`SMOKE_RESULT ${JSON.stringify(result)}\n`);
  process.exit(0);
})();
