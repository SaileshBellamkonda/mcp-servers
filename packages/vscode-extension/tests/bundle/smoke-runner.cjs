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
async function handshake(port, token = TOKEN) {
  const none = await rpc(port, INITIALIZE);
  assert(none.status === 401, `initialize without a token returned ${String(none.status)}, expected 401`);
  const wrong = await rpc(port, INITIALIZE, { token: `${token}x` });
  assert(wrong.status === 401, `initialize with a wrong token returned ${String(wrong.status)}, expected 401`);
  const ok = await rpc(port, INITIALIZE, { token });
  assert(ok.status === 200, `initialize with the token returned ${String(ok.status)}: ${ok.text.slice(0, 200)}`);
  assert(ok.session, 'initialize returned no mcp-session-id');
  await rpc(port, { jsonrpc: '2.0', method: 'notifications/initialized' }, { token, session: ok.session });
  return ok.session;
}

let nextId = 10;
async function callTool(port, session, name, args, token = TOKEN) {
  const response = await rpc(port, { jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }, { token, session });
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
        toolset: 'all', // the steps below call index_code, which the default toolset does not offer
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
  class Uri {
    constructor(scheme, p) { this.scheme = scheme; this.path = p; }
    static file(p) { return new Uri('file', p.replaceAll('\\', '/')); }
    static parse(value) { const m = /^([a-z][a-z0-9+.-]*):(?:\/\/)?(.*)$/i.exec(value); return new Uri(m[1], m[2]); }
    get fsPath() { return this.path; }
    toString() { return `${this.scheme}://${this.path}`; }
  }
  class McpHttpServerDefinition {
    constructor(label, uri, headers = {}, version) { this.label = label; this.uri = uri; this.headers = headers; this.version = version; }
  }
  const settings = state.settings;
  const listenerList = () => {
    const listeners = [];
    return (listener) => { listeners.push(listener); return { dispose() { listeners.splice(listeners.indexOf(listener), 1); } }; };
  };
  return {
    EventEmitter,
    Uri,
    McpHttpServerDefinition,
    StatusBarAlignment: { Left: 1, Right: 2 },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    TreeItem: class { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } },
    ThemeColor: class { constructor(id) { this.id = id; } },
    ThemeIcon: class { constructor(id, color) { this.id = id; this.color = color; } },
    window: {
      createOutputChannel: () => ({ appendLine: (line) => { state.output.push(line); }, dispose() {} }),
      showErrorMessage: (message) => { state.errors.push(message); return Promise.resolve(undefined); },
      showWarningMessage: (message, ...rest) => { state.warnings.push(message); return Promise.resolve(state.warningAnswers.shift?.() ?? undefined); },
      showInformationMessage: () => Promise.resolve(undefined),
      showQuickPick: (items) => Promise.resolve(state.quickPicks.shift()?.(items)),
      showInputBox: () => Promise.resolve(undefined),
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
    lm: {
      registerMcpServerDefinitionProvider: (id, provider) => { state.mcpProviders.set(id, provider); return { dispose() { state.mcpProviders.delete(id); } }; },
    },
    env: { clipboard: { writeText: (text) => { state.clipboard.push(text); return Promise.resolve(); } }, remoteName: undefined },
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

/**
 * The extension run uses fixed ports (the settings name them), so a port that was free when `freePort()` returned
 * can be taken by a parallel test suite (or an outgoing connection that happens to use it as its source port)
 * before the extension binds it. Such a failure says nothing about the bundle: the run is repeated with fresh
 * ports, up to `maxAttempts` times. A genuine defect fails every attempt and is reported as usual.
 */
const PORT_RACE = /EADDRINUSE|already in use|ECONNREFUSED|still open|fetch failed/i;

function failedOnPortRace(outcome) {
  const messages = [...Object.values(outcome.steps).filter((entry) => !entry.ok).map((entry) => entry.error ?? ''), outcome.fatal ?? ''];
  return messages.some((message) => PORT_RACE.test(message));
}

async function runExtension(maxAttempts = 3) {
  for (let attempt = 1; ; attempt++) {
    result.steps = {};
    delete result.fatal;
    try {
      await runExtensionOnce();
    } catch (error) {
      result.fatal = error instanceof Error ? error.stack : String(error);
    }
    result.attempts = attempt;
    if (attempt >= maxAttempts || !failedOnPortRace(result)) return;
    process.stderr.write(`bundle-smoke: attempt ${String(attempt)} failed on a port conflict, retrying with new ports\n`);
  }
}

async function runExtensionOnce() {
  const bundle = path.resolve(arg('bundle'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-smoke-ext-'));
  const repo = path.join(work, 'repo');
  fs.mkdirSync(repo);
  childProcess.execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'ignore' });
  const gitPort = await freePort();
  const ragPort = await freePort();
  const embeddings = await startFakeEmbeddings();
  const globalStorage = path.join(work, 'globalStorage');
  const state = {
    settings: {
      'mcpServers.git.port': gitPort,
      'mcpServers.git.autoStart': true,
      'mcpServers.coderag.port': ragPort,
      'mcpServers.coderag.embeddingUrl': `http://127.0.0.1:${String(embeddings.port)}/v1`,
      'mcpServers.coderag.embeddingModel': 'fake-embedding',
      'mcpServers.coderag.embeddingDim': 8,
    },
    folders: [],
    output: [], errors: [], warnings: [], warningAnswers: [], quickPicks: [], commands: new Map(), clipboard: [], tree: undefined,
    mcpProviders: new Map(),
  };
  const stub = createVscodeStub(state);
  state.folders.push({ uri: stub.Uri.file(repo), name: 'repo', index: 0 });
  const secrets = new Map();
  const secretListeners = [];
  const context = {
    subscriptions: [],
    globalStorageUri: stub.Uri.file(globalStorage),
    storageUri: stub.Uri.file(path.join(work, 'workspaceStorage')),
    secrets: {
      get: (key) => Promise.resolve(secrets.get(key)),
      store: (key, value) => { secrets.set(key, value); secretListeners.forEach((l) => l({ key })); return Promise.resolve(); },
      delete: (key) => { secrets.delete(key); secretListeners.forEach((l) => l({ key })); return Promise.resolve(); },
      onDidChange: (listener) => { secretListeners.push(listener); return { dispose() { secretListeners.splice(secretListeners.indexOf(listener), 1); } }; },
    },
  };
  const tree = () => state.tree.getChildren().map((element) => ({ id: element.id, item: state.tree.getTreeItem(element) }));
  const item = (id) => tree().find((entry) => entry.id === id)?.item;
  const tokensDir = path.join(globalStorage, 'tokens');
  const helperPath = path.join(globalStorage, 'bin', 'mcp-headers.js');
  /** The token of one server as a client sees it: through the installed headers helper, run like Claude Code runs it. */
  const tokenFromHelper = (serverId = 'git') => {
    const scope = fs.readdirSync(tokensDir).find((name) => /^[0-9a-f]{16}\.json$/.test(name)).replace('.json', '');
    const out = childProcess.execFileSync(process.execPath, [helperPath, scope, serverId, '--dir', tokensDir], { encoding: 'utf8' });
    const authorization = JSON.parse(out).Authorization;
    assert(authorization.startsWith('Bearer '), `helper printed ${out}`);
    return { scope, token: authorization.slice('Bearer '.length) };
  };

  // Resolve `vscode` to the stub for any module the bundle loads.
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    return request === 'vscode' ? stub : originalLoad.call(this, request, parent, isMain);
  };
  let extension;
  let deactivated = false;
  try {
    await step('extension.load', () => {
      extension = require(bundle);
      assert(typeof extension.activate === 'function', 'bundle does not export activate');
      assert(typeof extension.deactivate === 'function', 'bundle does not export deactivate');
    });
    if (!extension) return;
    await step('extension.activate', () => {
      extension.activate(context);
      const commands = [...state.commands.keys()].sort();
      assert(commands.includes('mcpServers.startServer') && commands.includes('mcpServers.stopServer'), `commands registered: ${commands.join(', ')}`);
      assert(state.tree, 'no tree view was created');
      assert(state.mcpProviders.has('mcpServers.servers'), 'the MCP server definition provider was not registered');
      return { commands };
    });
    // autoStart is on and the workspace folder is a real git repository: the git server must come up by itself on
    // the configured port and refuse unauthenticated requests. CodeRAG stays stopped (its autoStart default is off).
    await step('extension.autostart', async () => {
      const current = await waitFor('the git server to run', () => {
        const git = item('git');
        assert(git?.contextValue !== 'server.error', `git server failed: ${state.errors.join(' | ')} ${state.output.join(' | ')}`);
        return git?.contextValue === 'server.running' ? git : undefined;
      });
      assert(current.description === `running on port ${String(gitPort)}`, `unexpected description: ${current.description}`);
      const unauthenticated = await rpc(gitPort, INITIALIZE);
      assert(unauthenticated.status === 401, `unauthenticated initialize returned ${String(unauthenticated.status)}`);
      assert(state.errors.length === 0, `unexpected error messages: ${state.errors.join(' | ')}`);
      assert(item('coderag')?.contextValue === 'server.stopped', `coderag should wait for the user: ${String(item('coderag')?.contextValue)}`);
    });
    await step('extension.copy_url', async () => {
      await state.commands.get('mcpServers.copyServerUrl')('git');
      assert(state.clipboard.at(-1) === `http://127.0.0.1:${String(gitPort)}/mcp`, `clipboard: ${state.clipboard.join(' | ')}`);
    });
    // A port held by someone else must surface as one clear error from the awaited activation, and the server must
    // start once the port is free again.
    await step('extension.port_in_use', async () => {
      await state.commands.get('mcpServers.stopServer')('git');
      await assertClosed(gitPort, 'after stopServer');
      const squatter = require('node:net').createServer();
      await new Promise((resolve, reject) => { squatter.once('error', reject); squatter.listen(gitPort, '127.0.0.1', resolve); });
      try {
        await state.commands.get('mcpServers.startServer')('git');
        assert(item('git')?.contextValue === 'server.error', `expected server.error, got ${String(item('git')?.contextValue)}`);
        assert(state.errors.length === 1 && state.errors[0].includes(`Port ${String(gitPort)} is already in use`), `error messages: ${state.errors.join(' | ')}`);
      } finally {
        await new Promise((resolve) => { squatter.close(resolve); });
      }
      state.errors.length = 0;
      await state.commands.get('mcpServers.startServer')('git');
      assert(item('git')?.contextValue === 'server.running', `expected server.running after retry, got ${String(item('git')?.contextValue)}`);
    });

    // CodeRAG: started by the user. Where the runtime lacks FTS5 (VS Code 1.101-1.102) it must be reported as
    // unavailable with the reason and must not crash anything; elsewhere it must run end to end.
    let ragRunning = false;
    await step('extension.coderag_start', async () => {
      await state.commands.get('mcpServers.startServer')('coderag');
      const entry = item('coderag');
      const info = { contextValue: entry?.contextValue, description: entry?.description };
      assert(entry?.contextValue !== 'server.error', `coderag failed to start: ${state.errors.join(' | ')} ${state.output.join(' | ')}`);
      ragRunning = entry?.contextValue === 'server.running';
      assert(item('git')?.contextValue === 'server.running', 'git must keep running whatever coderag does');
      return info;
    });
    let token;
    let ragToken;
    await step('extension.token', () => {
      // One secret per workspace, mirrored to a file that only the helper script reads; each server gets its own
      // token derived from it, so the helper prints different tokens for git and coderag.
      const found = tokenFromHelper('git');
      token = found.token;
      ragToken = tokenFromHelper('coderag').token;
      assert(/^[0-9a-f]{64}$/.test(token), 'unexpected token shape');
      assert(/^[0-9a-f]{64}$/.test(ragToken) && ragToken !== token, 'git and coderag must have different tokens');
      assert(tokenFromHelper('git').token === token, 'the git token is not stable');
      const workspaceToken = JSON.parse(fs.readFileSync(path.join(tokensDir, `${found.scope}.json`), 'utf8')).token;
      assert(workspaceToken !== token && workspaceToken !== ragToken, 'the helper printed the workspace token');
      if (process.platform !== 'win32') {
        const fileMode = fs.statSync(path.join(tokensDir, `${found.scope}.json`)).mode & 0o777;
        const dirMode = fs.statSync(tokensDir).mode & 0o777;
        assert(fileMode === 0o600 && dirMode === 0o700, `modes: file ${fileMode.toString(8)}, directory ${dirMode.toString(8)}`);
      }
      const output = state.output.join('\n');
      assert(![token, ragToken, workspaceToken].some((secret) => output.includes(secret)), 'a token was written to the output channel');
      return { scope: found.scope };
    });
    await step('extension.git_token', async () => {
      const session = await handshake(gitPort, token);
      assert(session, 'git did not accept the helper token');
    });
    if (ragRunning) {
      await step('extension.coderag_works', async () => {
        const session = await handshake(ragPort, ragToken);
        const status = JSON.parse(await callTool(ragPort, session, 'get_index_status', {}, ragToken));
        // A token is only good for its own server: git's token is refused by coderag and the other way round.
        assert((await rpc(ragPort, INITIALIZE, { token })).status === 401, 'coderag accepted the git token');
        assert((await rpc(gitPort, INITIALIZE, { token: ragToken })).status === 401, 'git accepted the coderag token');
        assert(status.embedding_dim === 8, `unexpected index status ${JSON.stringify(status)}`);
        assert(fs.existsSync(path.join(work, 'workspaceStorage', 'coderag.db')), 'the database is not in the workspace storage');
      });
    }
    // VS Code's MCP integration: definitions list the servers; resolving injects the same token as a header.
    await step('extension.mcp_provider', async () => {
      const provider = state.mcpProviders.get('mcpServers.servers');
      const definitions = provider.provideMcpServerDefinitions({});
      const labels = definitions.map((d) => d.label);
      assert(labels.includes('MCP Servers: Git'), `definitions: ${labels.join(', ')}`);
      // CodeRAG is offered only where it can run (an unavailable server is omitted).
      assert(labels.includes('MCP Servers: CodeRAG') === ragRunning, `definitions: ${labels.join(', ')}`);
      assert(!JSON.stringify(definitions).includes(token), 'a listed definition contains the token');
      if (ragRunning) {
        const rag = await provider.resolveMcpServerDefinition(definitions.find((d) => d.label === 'MCP Servers: CodeRAG'), {});
        assert(rag.headers.Authorization === `Bearer ${ragToken}`, 'resolve did not inject the CodeRAG token');
      }
      const git = await provider.resolveMcpServerDefinition(definitions.find((d) => d.label === 'MCP Servers: Git'), {});
      assert(git.headers.Authorization === `Bearer ${token}`, 'resolve did not inject the stored token');
      assert(git.uri.toString() === `http://127.0.0.1:${String(gitPort)}/mcp`, `unexpected uri ${git.uri.toString()}`);
      return { labels };
    });
    // Claude Code: write .mcp.json, then run its headersHelper command line through a shell like Claude Code does.
    await step('extension.add_to_claude_code', async () => {
      const wanted = ['git', ...(ragRunning ? ['coderag'] : [])];
      state.quickPicks.push((items) => items.filter((entry) => wanted.includes(entry.id)));
      state.quickPicks.push((items) => items.find((entry) => entry.action === 'write'));
      state.warningAnswers.push('Write .mcp.json');
      await state.commands.get('mcpServers.addToClaudeCode')();
      const file = path.join(repo, '.mcp.json');
      assert(fs.existsSync(file), `no .mcp.json was written: ${state.errors.join(' | ')}`);
      const text = fs.readFileSync(file, 'utf8');
      assert(!text.includes(token), '.mcp.json contains the token');
      const parsed = JSON.parse(text);
      const entry = parsed.mcpServers['vscode-git'];
      if (ragRunning) assert(!text.includes(ragToken), '.mcp.json contains the CodeRAG token');
      assert(entry.type === 'http' && entry.url === `http://127.0.0.1:${String(gitPort)}/mcp`, `unexpected entry ${JSON.stringify(entry)}`);
      if (process.platform !== 'win32') {
        // headersHelper runs through a shell; `node` stands for the runtime under test.
        const command = entry.headersHelper.replace(/^node /, `${JSON.stringify(process.execPath)} `);
        const out = childProcess.execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' });
        assert(JSON.parse(out).Authorization === `Bearer ${token}`, 'the headersHelper command line did not print the token header');
        if (ragRunning) {
          const ragCommand = parsed.mcpServers['vscode-coderag'].headersHelper.replace(/^node /, `${JSON.stringify(process.execPath)} `);
          const ragOut = childProcess.execFileSync('/bin/sh', ['-c', ragCommand], { encoding: 'utf8' });
          assert(JSON.parse(ragOut).Authorization === `Bearer ${ragToken}`, 'the CodeRAG headersHelper command line did not print the CodeRAG token');
        }
      }
      return { entries: Object.keys(parsed.mcpServers) };
    });
    // Rotation: the old token stops working, the new one is picked up by the helper and by the restarted servers.
    await step('extension.rotate', async () => {
      state.warningAnswers.push('Rotate');
      await state.commands.get('mcpServers.rotateToken')();
      const rotated = tokenFromHelper('git').token;
      const rotatedRag = tokenFromHelper('coderag').token;
      assert(rotated !== token && rotatedRag !== ragToken, 'the token did not change');
      assert(item('git')?.contextValue === 'server.running', 'git did not come back after the rotation');
      const old = await rpc(gitPort, INITIALIZE, { token });
      assert(old.status === 401, `the old token still works (${String(old.status)})`);
      await handshake(gitPort, rotated);
      if (ragRunning) await handshake(ragPort, rotatedRag);
      token = rotated;
      ragToken = rotatedRag;
    });
    // VS Code calls deactivate(), then disposes the subscriptions.
    await step('extension.deactivate', async () => {
      await extension.deactivate();
      deactivated = true;
      await assertClosed(gitPort, 'after deactivate()');
      if (ragRunning) await assertClosed(ragPort, 'after deactivate()');
      assert(item('git')?.contextValue === 'server.stopped', `expected server.stopped, got ${String(item('git')?.contextValue)}`);
    });
    await step('extension.dispose', () => {
      for (const disposable of context.subscriptions) disposable.dispose();
    });
  } finally {
    // A failed run must not leave servers listening or the bundle cached for the next attempt.
    if (extension && !deactivated) await Promise.resolve().then(() => extension.deactivate()).catch(() => undefined);
    delete require.cache[require.resolve(bundle)];
    Module._load = originalLoad;
    embeddings.server.close();
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
