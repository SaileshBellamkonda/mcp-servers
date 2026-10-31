# MCP Servers Monorepo - System Design

**Version:** 1.0  
**Last Updated:** 2026-10-26  
**Status:** Active

## Overview

This document describes the system design for the MCP Servers monorepo, a comprehensive architecture for building, managing, and deploying Model Context Protocol (MCP) servers with dual-mode operation capabilities.

### Purpose

The monorepo provides a unified development environment for creating MCP servers that can operate in two distinct modes:
- **Standalone Mode**: Independent processes communicating via stdio or Streamable HTTP
- **Embedded Mode**: The same servers hosted in the VS Code extension host, reachable over authenticated loopback HTTP

### Key Design Goals

1. **Modularity**: Clear separation of concerns with independent, reusable packages
2. **Type Safety**: Strict TypeScript with cross-package type checking
3. **Developer Experience**: Modern tooling with fast builds and hot reload
4. **Scalability**: Easy addition of new servers and extensions
5. **Maintainability**: Consistent patterns and best practices across all packages

## Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Servers Monorepo                      │
│                                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐        │
│  │   Servers   │  │  Extensions  │  │   Shared    │        │
│  │  (MCP Core) │  │  (VS Code)   │  │  (Common)   │        │
│  └─────────────┘  └──────────────┘  └─────────────┘        │
│         │                 │                  │               │
│         └─────────────────┴──────────────────┘               │
│                           │                                   │
│                  ┌────────▼────────┐                         │
│                  │  Build System   │                         │
│                  │ (tsc/esbuild)   │                         │
│                  └─────────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

### Technology Stack

- **Package Manager**: pnpm with workspaces
- **Build System**: `tsc -b` project references (declarations, type checking) and esbuild (server and extension bundles); no Turbo
- **Testing**: Vitest with coverage reporting (85 % thresholds)
- **Language**: TypeScript (strict mode)
- **MCP SDK**: `@modelcontextprotocol/server` and `@modelcontextprotocol/hono` (2.0 alpha, pinned exactly in the shared packages)
- **HTTP**: Hono with `@hono/node-server`
- **Storage**: Node's built-in `node:sqlite` plus the `sqlite-vec` extension (Node >= 24)
- **VS Code API**: vscode module for the extension (`engines.vscode >=1.125.0`)

## System Components

### 1. MCP Server Packages

**Location**: `packages/server-*` (`server-git`, `server-coderag`)

MCP servers are the core components that implement the Model Context Protocol. Each server is designed for dual-mode operation.

#### Architecture Pattern

```
┌─────────────────────────────────────────┐
│         MCP Server Package              │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │     Standalone Entry Point      │   │
│  │ (standalone.ts: stdio or HTTP)  │   │
│  └─────────────────────────────────┘   │
│                 │                       │
│                 ▼                       │
│  ┌─────────────────────────────────┐   │
│  │      Core Server Logic          │   │
│  │ (server/*-server.ts, tools/)    │   │
│  └─────────────────────────────────┘   │
│                 │                       │
│                 ▼                       │
│  ┌─────────────────────────────────┐   │
│  │     Embedded Entry Point        │   │
│  │ (embedded.ts: HTTP + bearer)    │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

#### Key Features

- **Dual Entry Points**: Separate entry points for standalone and embedded modes (both bundled by the package's `bundle` script, an esbuild command)
- **Transport Abstraction**: stdio or HTTP for standalone, authenticated loopback HTTP for embedded; HTTP always goes through `@mcp-servers/http-host`
- **One server per session**: the HTTP host calls a `createServer` factory for every session, so each session has its own `McpServer` while the domain services (repository manager, vector database) are shared
- **Tool Registration**: each tool lives in `tools/` and is registered with `server.registerTool()`


#### Package Structure

```
packages/server-name/
├── src/
│   ├── standalone.ts     # Standalone entry (stdio or HTTP, configured by environment variables)
│   ├── embedded.ts       # Embedded entry (activate*Server({ port, authToken, ... }) -> { port, close })
│   ├── server/           # createXServer(server, services): registers the tools (mode-agnostic)
│   ├── core/             # Domain services, configuration, validation
│   └── tools/            # Tool implementations
├── tests/                # unit/, integration/, fixtures/
├── package.json          # exports "." (standalone) and "./embedded"; bin
└── README.md             # Documentation
```

### 2. VS Code Extension Packages

**Location**: `packages/vscode-extension` (package name `mcp-servers`)

Extensions provide VS Code integration for MCP servers, running them in embedded mode within the extension host process.

#### Architecture Pattern

```
┌─────────────────────────────────────────┐
│      VS Code Extension Package          │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │    Extension Activation         │   │
│  │      (extension.ts)             │   │
│  └─────────────────────────────────┘   │
│                 │                       │
│                 ▼                       │
│  ┌─────────────────────────────────┐   │
│  │     Server Manager              │   │
│  │  (lifecycle management)         │   │
│  └─────────────────────────────────┘   │
│                 │                       │
│                 ▼                       │
│  ┌─────────────────────────────────┐   │
│  │   Embedded MCP Server           │   │
│  │  (from server package)          │   │
│  └─────────────────────────────────┘   │
│                 │                       │
│                 ▼                       │
│  ┌─────────────────────────────────┐   │
│  │    VS Code Commands/UI          │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```


#### Key Responsibilities

- **Server Lifecycle**: A descriptor-driven adapter starts, stops and restarts each embedded server (Git, CodeRAG); CodeRAG is feature-detected and only offered where `node:sqlite` with FTS5, sqlite-vec and tree-sitter load
- **Authentication**: One stable bearer token per workspace (Secret Storage, mirrored to a `0600` file), used by the VS Code MCP server definition provider and by a headers helper script for Claude Code
- **UI Integration**: Expose MCP functionality through VS Code commands and views
- **Configuration**: Manage extension settings and preferences
- **Error Handling**: Graceful error handling and user feedback

### 3. Shared Packages

**Location**: `packages/shared/*`

Shared packages provide common functionality used across servers and extensions. They are `private` (never
published) and are inlined into the server and extension bundles at build time, so published or npx-run servers need
no unpublished package. Workspace consumers resolve them to source through the `@mcp-servers/source` export condition.

#### Packages

**@mcp-servers/common**
- `parsePort`, `parseList` (`;`-separated, trimmed), `parseBool`
- `McpLogger` (stderr plus MCP logging notifications)

**@mcp-servers/http-host**
- `startMcpHttpServer`: the Streamable HTTP host (one `McpServer` per session, graceful `close()`)
- Bearer-token authentication, loopback checks, Origin and Content-Type guards, session and body limits
- `@mcp-servers/http-host/testing`: ephemeral-port start and a raw JSON-RPC client for tests

Code that only one package uses (for example CodeRAG's `PathGuard`) stays in that package until a second consumer
exists.

## Build System Design

### Dependency Graph

```
Level 1: @mcp-servers/common (no workspace dependencies)
           ↓
Level 2: @mcp-servers/http-host (depends on common)
           ↓
Level 3: server-git, server-coderag (bundle common + http-host)
           ↓
Level 4: vscode-extension (bundles the servers' embedded entry points)
```

### Build Orchestration

**Root scripts** run `pnpm -r`, which orders packages by their workspace dependencies.

**Build Process** (`pnpm build`):
1. Shared packages: `tsc -b` emits JavaScript and declarations
2. Servers: clean, esbuild bundles `src/standalone.ts` and `src/embedded.ts` into `dist/` (the private `@mcp-servers/*` packages are inlined; third-party and native dependencies stay external), then `tsc -b` emits declarations only
3. Extension: esbuild bundles the extension and the headers helper to CommonJS; `pnpm --filter ./packages/vscode-extension run package` also stages the native modules for a target and runs `vsce package`
4. `pnpm typecheck`, `pnpm test` and `pnpm lint` run separately

### Workspace Configuration

**pnpm Workspaces**:
- Manages inter-package dependencies (`packages/*` and `packages/shared/*`)
- Uses `workspace:*` protocol for local packages and a `catalog:` for shared version ranges
- Hoists common dependencies to root
- Enables hot reload in development

## Dual-Mode Operation Design

### Standalone Mode

**Purpose**: Run as independent MCP server for external clients

**Transport**: stdio (`StdioServerTransport`, the default) or Streamable HTTP (`MCP_TRANSPORT=http`, served by `@mcp-servers/http-host`)

**Entry Point**: `src/standalone.ts`

**Characteristics**:
- Runs as separate process
- stdio: communicates via standard input/output; HTTP: listens on `127.0.0.1` by default
- Can be used with any MCP-compatible client
- Suitable for CLI tools and external integrations
- Configured by environment variables (`MCP_TRANSPORT`, `MCP_HTTP_HOST`, `MCP_HTTP_PORT`, `MCP_AUTH_TOKEN` and per-server variables)

### Embedded Mode

**Purpose**: Run within VS Code extension host process

**Transport**: Streamable HTTP on `127.0.0.1` (never another interface), bearer token mandatory

**Entry Point**: `src/embedded.ts` (`activateGitServer` / `activateCodeRagServer` take `{ port, authToken, ... }` and return `{ port, close }`)

**Characteristics**:
- Shares the extension host process (no child process)
- The embedded entry points do not import `vscode`; the extension passes workspace folders, settings and the token in
- The extension registers each server with VS Code's MCP API and can write a Claude Code configuration
- Integrated lifecycle management
- A native crash in CodeRAG would take the whole extension host down

### Mode Abstraction

The core server logic (`server/*-server.ts`, `core/`, `tools/`) is mode-agnostic:
- No transport-specific code
- Pure business logic
- Tool implementations
- Reusable across both modes
- Each entry point builds the shared services once and registers the tools on a new `McpServer` per session (HTTP) or on one server (stdio)

### Storage (server-coderag)

- One SQLite file per index, opened with Node's built-in `node:sqlite` (`DatabaseSync`) through a thin adapter in
  `vectordb/sqlite-db.ts`; there is no `better-sqlite3` dependency
- Vectors are stored in a `vec0` virtual table from the `sqlite-vec` extension, loaded with `allowExtension`; keyword
  search uses an FTS5 table. New databases create `vec0` with `chunk_size=256` (the default 1024 blocks the event loop
  for seconds during bulk inserts)
- Requires Node.js >= 24 (`node:sqlite` with FTS5). The VS Code extension feature-detects
  all of this and reports CodeRAG as unavailable with the reason where it does not hold
- Native modules (tree-sitter and its grammars, sqlite-vec) are not bundled; the extension stages them per target
  under `dist/native` and passes `nativeModulesDir` to the server


## Type Safety & TypeScript Configuration

### Project References

TypeScript project references enable:
- Cross-package type checking
- Incremental compilation
- Build-time dependency validation
- IDE performance optimization

### Configuration Hierarchy

```
Root tsconfig.json (base configuration)
    ↓
Package tsconfig.json (extends root)
    ↓
tsconfig.build.json (production builds)
```

### Strict Mode

All packages use strict TypeScript:
- No implicit any
- Strict null checks
- Strict function types
- No unused locals/parameters

## Development Workflow

### Local Development

```bash
# Install dependencies
pnpm install

# Start all packages in watch mode
pnpm dev

# Start specific package
pnpm --filter @mcp-servers/server-name dev
```

### Testing Strategy

**Unit Tests**:
- Test individual functions and classes
- Mock external dependencies
- Fast execution

**Integration Tests**:
- Test server initialization
- Test tool execution
- Test both standalone and embedded modes

**Coverage Requirements**:
- Minimum 80% code coverage
- Critical paths must be 100% covered


### Quality Assurance

**Automated Checks**:
- Type checking (tsc --noEmit)
- Linting (ESLint)
- Formatting (Prettier)
- Unit and integration tests
- Build verification

**CI/CD Pipeline**:
- Run on every pull request
- Enforce code quality standards
- Automated testing
- Build verification
- Release automation

## Dependency Management

### Internal Dependencies

Use `workspace:*` protocol for all internal dependencies:

```json
{
  "dependencies": {
    "@mcp-servers/types": "workspace:*",
    "@mcp-servers/utils": "workspace:*"
  }
}
```

**Benefits**:
- Always uses local version during development
- Automatic resolution to published version on release
- Type checking works across packages
- Hot reload in watch mode

### External Dependencies

**Root-Level** (shared across all packages):
- TypeScript
- Vitest
- ESLint
- Prettier
- esbuild (a devDependency of each bundled package)

**Package-Level** (specific to package needs):
- @modelcontextprotocol/server and @modelcontextprotocol/hono (servers, `http-host`)
- @types/vscode (for extensions)
- Package-specific libraries

### Version Management

**Changesets Workflow**:
1. Developer creates changeset describing changes
2. CI validates changeset exists for PRs
3. Changesets accumulate on main branch
4. Release PR created automatically
5. Merge release PR to publish packages


## Naming Conventions

### Package Naming

**Format**: `@mcp-servers/server-[name]` for servers, `@mcp-servers/[name]` for shared packages

**Examples**:
- Servers: `@mcp-servers/server-git`, `@mcp-servers/server-coderag`
- Extension: `mcp-servers` (unscoped, as the Marketplace requires), in `packages/vscode-extension`
- Shared (private): `@mcp-servers/common`, `@mcp-servers/http-host`

### Code Naming

- **Classes**: PascalCase (e.g., `ServerManager`, `EmbeddedMCPServer`)
- **Interfaces/Types**: PascalCase (e.g., `ServerOptions`, `ToolHandler`)
- **Functions/Variables**: camelCase (e.g., `createServer`, `serverInstance`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_RETRIES`, `DEFAULT_TIMEOUT`)
- **Files**: kebab-case (e.g., `server-manager.ts`, `tool-registry.ts`)

## Scalability Considerations

### Adding New Servers

1. Create package directory: `packages/server-new/`
2. Copy template structure from existing server
3. Implement dual-mode pattern (`standalone.ts`, `embedded.ts`, `server/`) on top of `@mcp-servers/http-host`
4. Add comprehensive tests
5. Update root TypeScript references
6. Document in README

### Adding New Extensions

1. Create package directory under `packages/` (today there is one extension, `packages/vscode-extension`, which hosts every server through a descriptor)
2. Copy template structure from existing extension
3. Implement extension activation and server manager
4. Add VS Code commands and UI
5. Add tests
6. Update root TypeScript references
7. Document in README

### Adding New Shared Packages

1. Create package directory: `packages/shared/package-name/`
2. Implement shared functionality
3. Export public API from index.ts
4. Add comprehensive tests
5. Update dependent packages
6. Document API thoroughly


## Performance Optimization

### Build Performance

**Incremental Compilation**:
- TypeScript project references enable incremental builds
- Only recompiles changed files
- Maintains type information across builds

**Parallel Execution**:
- Independent packages build concurrently
- Maximizes CPU utilization
- Respects dependency ordering

### Runtime Performance

**Embedded Mode Optimization**:
- No stdio overhead
- Direct function calls
- Shared memory space with extension
- Faster tool execution

**Lazy Loading**:
- Load tools and resources on demand
- Reduce initial startup time
- Lower memory footprint

## Security Considerations

### Input Validation

- Validate all tool arguments
- Sanitize file paths
- Prevent path traversal attacks
- Validate resource URIs

### Permissions

**Standalone Mode**:
- Runs with user's permissions
- File system access is further limited by the servers: `server-git` to the repositories in `GIT_ALLOWED_REPOS`, `server-coderag` to its allowed roots
- Network access as needed (CodeRAG sends indexed text to the configured embeddings endpoint)

**Embedded Mode**:
- Runs in the VS Code extension host process with the user's permissions (the extension host is not a sandbox)
- Access limited to the workspace folders by the same server-level checks
- Requires a bearer token; the token is never in settings, logs, URLs or generated client configuration

### HTTP Transport Security

All HTTP serving goes through `@mcp-servers/http-host`:
- Binds `127.0.0.1` by default and always passes the host to `listen`; a non-loopback `MCP_HTTP_HOST` is refused unless `MCP_AUTH_TOKEN` (>= 32 characters) is set; embedded servers never bind anything but loopback
- With a token, every request needs `Authorization: Bearer <token>` (constant-time comparison, bare `401` otherwise, token never logged)
- `Host` header validation on loopback binds; a foreign `Origin` is rejected with `403` unless listed in `allowedOrigins`; `POST` requires `application/json` (`415`)
- Limits: 64 concurrent sessions (`429`), 30 minutes session idle timeout, 4 MiB request bodies (`413`)
- Not provided: TLS, rate limiting, OAuth, per-tool authorization

### Path Confinement

- `server-git`: repository allow-list, path validation with symlinks resolved, git argument validation (no option or pathspec injection, remotes limited to configured names unless `GIT_ALLOW_REMOTE_URLS`), and an allow-listed environment for git processes
- `server-coderag`: `PathGuard` limits every tool that reads or writes a path to the working directory or workspace folders, the include-glob bases and `CODERAG_ALLOWED_ROOTS`, with symlinks resolved
- In the extension, settings that widen file access or redirect data (`allowedRoots`, include patterns, `embeddingUrl`) are machine scoped so a repository's `.vscode/settings.json` cannot set them

### Dependency Security

- Regular dependency audits
- Automated security updates
- Minimal dependency footprint
- Trusted sources only


## Error Handling Strategy

### Error Categories

**Validation Errors**:
- Invalid tool arguments
- Malformed requests
- Type mismatches

**Runtime Errors**:
- File system errors
- Network failures
- Resource unavailability

**Protocol Errors**:
- Invalid MCP messages
- Transport failures
- Connection issues

### Error Handling Patterns

**Graceful Degradation**:
- Continue operation when possible
- Provide meaningful error messages
- Log errors for debugging

**User Feedback**:
- Clear error messages
- Actionable suggestions
- Context-aware help

**Recovery Mechanisms**:
- Automatic retry for transient failures
- Fallback strategies
- State recovery

## Monitoring & Observability

### Logging

**Levels**:
- ERROR: Critical failures
- WARN: Potential issues
- INFO: Important events
- DEBUG: Detailed diagnostics

**Structured Logging**:
- JSON format for machine parsing
- Contextual information
- Correlation IDs for tracing

### Metrics

**Build Metrics**:
- Build duration per package
- Cache hit rate
- Test execution time

**Runtime Metrics**:
- Tool execution time
- Error rates
- Resource usage


## Documentation Strategy

### Package Documentation

Each package includes:
- **README.md**: Overview, installation, usage examples
- **API Documentation**: Generated from TypeScript types
- **Examples**: Common use cases and patterns
- **Troubleshooting**: Common issues and solutions

### Repository Documentation

**docs/DESIGN.md** (this document):
- System architecture
- Design decisions
- Component interactions

**docs/ROADMAP.md**:
- Future features
- Planned improvements
- Version milestones

**docs/specs/**:
- Detailed specifications
- Feature proposals
- Technical requirements

**docs/plans/**:
- Implementation plans
- Task breakdowns
- TDD approach

**docs/adr/**:
- Architecture Decision Records
- Design rationale
- Trade-off analysis

## Testing Strategy

### Test Pyramid

```
        ┌─────────────┐
        │   E2E Tests │  (Few)
        └─────────────┘
      ┌─────────────────┐
      │ Integration Tests│  (Some)
      └─────────────────┘
    ┌─────────────────────┐
    │     Unit Tests      │  (Many)
    └─────────────────────┘
```

### Test-Driven Development

**Red-Green-Refactor Cycle**:
1. **Red**: Write failing test
2. **Green**: Write minimal code to pass
3. **Refactor**: Improve code while keeping tests green


### Test Coverage

**Unit Tests**:
- Individual functions and classes
- Mock external dependencies
- Fast execution (<1s per test)
- High coverage (>80%)

**Integration Tests**:
- Server initialization
- Tool execution end-to-end
- Both standalone and embedded modes
- Resource handling

**Test Utilities**:
- Shared test fixtures
- Mock MCP clients
- Server test harness
- Custom matchers

## Maintenance & Operations

### Code Quality Standards

- **Type Safety**: Strict TypeScript, no `any` types
- **Test Coverage**: Minimum 80% coverage
- **Documentation**: All public APIs documented
- **Code Review**: Required for all changes
- **Linting**: ESLint with strict rules
- **Formatting**: Prettier for consistent style

### Dependency Updates

**Regular Updates**:
- Weekly dependency checks
- Security patches applied immediately
- Major version updates planned
- Breaking changes documented

**Update Process**:
1. Check for outdated dependencies
2. Review changelogs
3. Update and test locally
4. Create changeset
5. Submit PR with changes

### Breaking Changes

**Process**:
1. Create changeset with major version bump
2. Document migration path
3. Update all affected packages
4. Provide migration guide
5. Consider deprecation period


## Deployment Strategy

### Package Publishing

**npm Registry**:
- Publish to public npm registry
- Server packages under the @mcp-servers scope; the shared packages are private and bundled into them
- Semantic versioning
- Automated via CI/CD

**VS Code Marketplace**:
- Extensions published to marketplace
- VSIX packaging
- Version synchronization with server packages
- Automated publishing workflow

### Release Process

1. **Development**: Feature branches merged to main
2. **Changesets**: Accumulated on main branch
3. **Release PR**: Automatically created by changesets
4. **Review**: Team reviews release PR
5. **Merge**: Triggers automated publishing
6. **Verification**: Smoke tests on published packages

## Future Considerations

### Extensibility

**Plugin System**:
- Allow third-party tool implementations
- Plugin discovery mechanism
- Sandboxed execution
- Version compatibility

**Custom Transports**:
- WebSocket for real-time communication
- TLS for non-loopback HTTP (today put the server behind a reverse proxy)
- Custom transport implementations

### Performance Enhancements

**Caching**:
- Tool result caching
- Resource caching
- Intelligent cache invalidation

**Optimization**:
- Lazy loading of tools
- Code splitting for extensions
- Bundle size optimization

### Monitoring Improvements

**Telemetry**:
- Anonymous usage statistics
- Error reporting
- Performance metrics
- User consent required


## Design Principles Summary

### 1. Separation of Concerns

- **Transport Layer**: Isolated from business logic
- **Core Logic**: Mode-agnostic and reusable
- **Entry Points**: Separate for each operational mode

### 2. Reusability

- **Shared Packages**: Common functionality extracted
- **Dual-Mode Design**: Same core logic for both modes
- **Type Definitions**: Shared across all packages

### 3. Developer Experience

- **Fast Builds**: Incremental `tsc -b`, esbuild bundling and parallel `pnpm -r` execution
- **Hot Reload**: Watch mode for rapid iteration
- **Type Safety**: Catch errors at compile time
- **Clear Errors**: Meaningful error messages

### 4. Maintainability

- **Consistent Patterns**: Same structure across packages
- **Comprehensive Tests**: High coverage requirements
- **Documentation**: All public APIs documented
- **Code Quality**: Automated checks and reviews

### 5. Scalability

- **Easy Addition**: Simple process for new packages
- **Independent Packages**: Minimal coupling
- **Parallel Development**: Teams can work independently
- **Performance**: Optimized build and runtime

## Conclusion

This system design provides a robust foundation for building and maintaining MCP servers with dual-mode operation. The architecture emphasizes:

- **Flexibility**: Servers work standalone or embedded
- **Quality**: Strict type safety and comprehensive testing
- **Efficiency**: Fast builds and optimized runtime
- **Maintainability**: Clear patterns and documentation
- **Scalability**: Easy to extend and grow

The design supports the project's goals of creating high-quality MCP servers that integrate seamlessly with VS Code while remaining usable as standalone tools.

---

**For detailed implementation specifications, see**: [`docs/specs/2026-04-22-mcp-monorepo-design.md`](specs/2026-04-22-mcp-monorepo-design.md)
