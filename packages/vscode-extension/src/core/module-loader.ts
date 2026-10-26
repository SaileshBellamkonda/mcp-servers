/**
 * The server packages the extension can load on demand. The values are the module types, so descriptors get typed
 * access while tests inject fakes. Adding a server means adding a line here and a `case` in
 * `servers/module-loader.ts` (that file holds the literal `import()` calls the bundler must see).
 */
export interface ServerModules {
  '@mcp-servers/server-git/embedded': typeof import('@mcp-servers/server-git/embedded');
}

/** Loads a server module by specifier (a dynamic import in production, a fake in tests). */
export type ModuleLoader = <K extends keyof ServerModules>(specifier: K) => Promise<ServerModules[K]>;
