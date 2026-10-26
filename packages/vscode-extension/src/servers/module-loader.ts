import type { ModuleLoader, ServerModules } from '../core/module-loader';

/**
 * Loads the embedded server modules on demand. Every module is a literal `import()` so the bundler can inline it
 * (a computed specifier would stay a runtime `require` that fails inside the installed extension). Adding a
 * server means adding its entry to `ServerModules` and here; the type makes the compiler insist on both.
 */
const LOADERS: { [S in keyof ServerModules]: () => Promise<ServerModules[S]> } = {
  '@mcp-servers/server-git/embedded': () => import('@mcp-servers/server-git/embedded'),
};

export const loadServerModule: ModuleLoader = (specifier) => LOADERS[specifier]();
