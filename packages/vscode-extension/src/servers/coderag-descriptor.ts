import path from 'node:path';
import { ensurePrivateDirectory } from '../core/private-dir';
import type { ConfigReader, ServerDescriptor, ServerLogger } from '../core/server-descriptor';

/** What the CodeRAG descriptor takes from the extension host; `vscode`-free so it is unit-tested with fakes. */
export interface CodeRagEnvironment {
  /** The bundle's `dist/native` directory (tree-sitter, its grammars, sqlite-vec). */
  nativeModulesDir: string;
  /** The workspace storage directory (`context.storageUri`), or undefined when no folder is open. */
  storageDir: () => string | undefined;
  /** The embedding API key from SecretStorage, if the user stored one. Never read from a setting. */
  readApiKey: () => Promise<string | undefined>;
  /** True when the extension host runs on a remote (SSH, WSL, container, tunnel). */
  isRemote: () => boolean;
  /** Defaults to `process.versions.node`; named in the "Node.js too old" message. */
  nodeVersion?: string;
}

const SETTINGS_SECTION = 'mcpServers.coderag';
const DB_FILE = 'coderag.db';

/** Settings (besides `port`) that change what is indexed, how, or where embeddings go: a running server restarts. */
const RESTART_SETTINGS = [
  'embeddingUrl',
  'embeddingModel',
  'embeddingDim',
  'chunkSize',
  'topK',
  'docsInclude',
  'docsExclude',
  'codeInclude',
  'codeExclude',
  'useGitignore',
  'allowedRoots',
] as const;

type ProbeResult = { available: true } | { available: false; reason: string };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The `vsCodeConfig` the server reads. `dbPath` is ours (inside the workspace storage); `embeddingApiKey` is
 * deliberately never answered, so a key can only arrive through SecretStorage; an unset (empty) setting is
 * reported as undefined so the server's defaults apply (VS Code reports an unset array setting as `[]`).
 */
function configurationFor(config: ConfigReader, dbPath: string): { get(key: string): unknown } {
  return {
    get: (key) => {
      if (key === 'dbPath') return dbPath;
      if (key === 'embeddingApiKey') return undefined;
      if (!(RESTART_SETTINGS as readonly string[]).includes(key)) return undefined;
      const value = config.get<unknown>(SETTINGS_SECTION, key, undefined);
      if (value === '' || (Array.isArray(value) && value.length === 0)) return undefined;
      return value;
    },
  };
}

/** The server logger as CodeRAG's logger: debug output is dropped. */
function withDebug(logger: ServerLogger): ServerLogger & { debug(data: unknown): void } {
  return { debug: () => undefined, info: (d) => { logger.info(d); }, warning: (d) => { logger.warning(d); }, error: (d) => { logger.error(d); } };
}

/**
 * The CodeRAG MCP server, run in the extension host. It is feature-detected: `isAvailable` runs the capability
 * probe once per session (Node.js >= 22.14, `node:sqlite` with extensions and FTS5, sqlite-vec, tree-sitter with
 * its grammars from the bundle's native directory) and turns failures into a reason the user can act on.
 * One database per workspace lives in the workspace storage; all file-system folders are indexed and confine the
 * file tools. A change of the folder set restarts the server (it gets the token of the new scope).
 */
export function createCodeRagDescriptor(environment: CodeRagEnvironment): ServerDescriptor {
  let probe: Promise<ProbeResult> | undefined;

  const reasonFor = (result: { reason: string; needs?: 'fts5' | 'node' }): string => {
    if (result.needs === 'node') {
      return `Needs VS Code 1.101 or newer (Node.js 22.14+ with node:sqlite); this host runs Node.js ${environment.nodeVersion ?? process.versions.node}`;
    }
    if (result.needs === 'fts5') {
      return environment.isRemote()
        ? "Needs Node.js 22.16 or newer on the remote host (this host's SQLite lacks FTS5)"
        : "Needs VS Code 1.103 or newer (this build's SQLite lacks FTS5)";
    }
    return result.reason;
  };

  return {
    id: 'coderag',
    label: 'CodeRAG',
    settingsSection: SETTINGS_SECTION,
    defaultPort: 3100,
    autoStartDefault: false,
    requiresWorkspace: true,
    restartSettings: RESTART_SETTINGS,

    async isAvailable(context) {
      if (environment.storageDir() === undefined) return { available: false, reason: 'Open a folder to use CodeRAG' };
      probe ??= (async (): Promise<ProbeResult> => {
        try {
          const { probeCodeRagSupport } = await context.loadModule('@mcp-servers/server-coderag/embedded');
          const result = probeCodeRagSupport({ nativeModulesDir: environment.nativeModulesDir });
          return result.ok ? { available: true } : { available: false, reason: reasonFor(result) };
        } catch (error) {
          return { available: false, reason: `CodeRAG could not be loaded: ${describeError(error)}` };
        }
      })();
      return probe;
    },

    async activate(context) {
      const storageDir = environment.storageDir();
      if (storageDir === undefined) throw new Error('Open a folder to use CodeRAG');
      await ensurePrivateDirectory(storageDir);
      const apiKey = await environment.readApiKey();
      const { activateCodeRagServer } = await context.loadModule('@mcp-servers/server-coderag/embedded');
      const instance = await activateCodeRagServer({
        vsCodeConfig: configurationFor(context.config, path.join(storageDir, DB_FILE)),
        workspaceFolders: context.workspaceFolders,
        port: context.port,
        authToken: context.authToken,
        nativeModulesDir: environment.nativeModulesDir,
        ...(apiKey !== undefined && apiKey !== '' && { apiKey }),
        logger: withDebug(context.logger),
      });
      return { port: instance.port, host: instance.host, close: () => instance.close() };
    },
  };
}
