# MCP Servers Monorepo - System Design

**Version:** 1.0  
**Last Updated:** 2026-04-22  
**Status:** Active

## Overview

This document describes the system design for the MCP Servers monorepo, a comprehensive architecture for building, managing, and deploying Model Context Protocol (MCP) servers with dual-mode operation capabilities.

### Purpose

The monorepo provides a unified development environment for creating MCP servers that can operate in two distinct modes:
- **Standalone Mode**: Independent processes communicating via stdio/HTTP
- **Embedded Mode**: Integrated components within VS Code extensions

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
│                  │  (Turbo/pnpm)   │                         │
│                  └─────────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

### Technology Stack

- **Package Manager**: pnpm with workspaces
- **Build System**: Turbo for orchestration, TypeScript for compilation
- **Testing**: Vitest with coverage reporting
- **Language**: TypeScript (strict mode)
- **MCP SDK**: @modelcontextprotocol/sdk
- **VS Code API**: vscode module for extensions

## System Components

### 1. MCP Server Packages

**Location**: `packages/servers/*`

MCP servers are the core components that implement the Model Context Protocol. Each server is designed for dual-mode operation.

#### Architecture Pattern

```
┌─────────────────────────────────────────┐
│         MCP Server Package              │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │     Standalone Entry Point      │   │
│  │      (index.ts + stdio)         │   │
│  └─────────────────────────────────┘   │
│                 │                       │
│                 ▼                       │
│  ┌─────────────────────────────────┐   │
│  │      Core Server Logic          │   │
│  │   (server.ts - mode agnostic)   │   │
│  └─────────────────────────────────┘   │
│                 │                       │
│                 ▼                       │
│  ┌─────────────────────────────────┐   │
│  │     Embedded Entry Point        │   │
│  │   (embedded.ts + in-memory)     │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

#### Key Features

- **Dual Entry Points**: Separate entry points for standalone and embedded modes
- **Transport Abstraction**: stdio for standalone, in-memory for embedded
- **Tool Registry**: Centralized tool registration and management
- **Resource Handlers**: Support for MCP resources


#### Package Structure

```
packages/servers/server-name/
├── src/
│   ├── index.ts          # Standalone entry (stdio transport)
│   ├── embedded.ts       # Embedded entry (in-memory transport)
│   ├── server.ts         # Core logic (mode-agnostic)
│   ├── tools/            # Tool implementations
│   ├── resources/        # Resource implementations
│   └── types.ts          # Server-specific types
├── tests/                # Test files
├── package.json          # Package configuration
└── README.md             # Documentation
```

### 2. VS Code Extension Packages

**Location**: `packages/extensions/*`

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

- **Server Lifecycle**: Initialize and manage embedded MCP server instances
- **UI Integration**: Expose MCP functionality through VS Code commands and views
- **Configuration**: Manage extension settings and preferences
- **Error Handling**: Graceful error handling and user feedback

### 3. Shared Packages

**Location**: `packages/shared/*`

Shared packages provide common functionality used across servers and extensions.

#### Package Types

**@mcp-servers/types**
- Common TypeScript types and interfaces
- MCP protocol type definitions
- Shared type utilities

**@mcp-servers/utils**
- File system utilities
- Validation helpers
- Logging utilities
- Error handling

**@mcp-servers/testing**
- Test fixtures and mock data
- MCP-specific test utilities
- Custom Vitest matchers
- Server test harness

## Build System Design

### Dependency Graph

```
Level 1: @mcp-servers/types (no dependencies)
           ↓
Level 2: @mcp-servers/utils (depends on types)
           ↓
Level 3: Server packages (depend on types + utils)
           ↓
Level 4: Extension packages (depend on servers + shared)
```

### Build Orchestration

**Turbo Pipeline**:
- Handles dependency ordering automatically
- Caches unchanged packages
- Parallelizes independent builds
- Supports incremental compilation


**Build Process**:
1. Clean previous artifacts
2. Build shared types package
3. Build shared utils package
4. Build server packages in parallel
5. Build extension packages in parallel
6. Run type checking and tests

### Workspace Configuration

**pnpm Workspaces**:
- Manages inter-package dependencies
- Uses `workspace:*` protocol for local packages
- Hoists common dependencies to root
- Enables hot reload in development

## Dual-Mode Operation Design

### Standalone Mode

**Purpose**: Run as independent MCP server for external clients

**Transport**: stdio (StdioServerTransport)

**Entry Point**: `src/index.ts`

**Characteristics**:
- Runs as separate process
- Communicates via standard input/output
- Can be used with any MCP-compatible client
- Suitable for CLI tools and external integrations

### Embedded Mode

**Purpose**: Run within VS Code extension host process

**Transport**: In-memory (InMemoryTransport)

**Entry Point**: `src/embedded.ts`

**Characteristics**:
- Shares extension's process
- Direct function calls (no stdio overhead)
- Access to VS Code APIs
- Integrated lifecycle management

### Mode Abstraction

The core server logic (`server.ts`) is mode-agnostic:
- No transport-specific code
- Pure business logic
- Tool and resource implementations
- Reusable across both modes


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
- Turbo

**Package-Level** (specific to package needs):
- @modelcontextprotocol/sdk
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

**Format**: `@mcp-servers/[type]-[name]`

**Examples**:
- Servers: `@mcp-servers/server-filesystem`, `@mcp-servers/server-database`
- Extensions: `@mcp-servers/extension-filesystem`, `@mcp-servers/extension-database`
- Shared: `@mcp-servers/types`, `@mcp-servers/utils`

### Code Naming

- **Classes**: PascalCase (e.g., `ServerManager`, `EmbeddedMCPServer`)
- **Interfaces/Types**: PascalCase (e.g., `ServerOptions`, `ToolHandler`)
- **Functions/Variables**: camelCase (e.g., `createServer`, `serverInstance`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_RETRIES`, `DEFAULT_TIMEOUT`)
- **Files**: kebab-case (e.g., `server-manager.ts`, `tool-registry.ts`)

## Scalability Considerations

### Adding New Servers

1. Create package directory: `packages/servers/server-new/`
2. Copy template structure from existing server
3. Implement dual-mode pattern (index.ts, embedded.ts, server.ts)
4. Add comprehensive tests
5. Update root TypeScript references
6. Document in README

### Adding New Extensions

1. Create package directory: `packages/extensions/extension-new/`
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

**Turbo Caching**:
- Caches build outputs based on input hash
- Skips unchanged packages
- Shares cache across CI and local development
- Dramatically reduces build times

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
- File system access controlled by OS
- Network access as needed

**Embedded Mode**:
- Runs within VS Code sandbox
- Limited to workspace access
- Respects VS Code security model

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
- Scoped packages under @mcp-servers
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
- HTTP transport for web servers
- WebSocket for real-time communication
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

- **Fast Builds**: Turbo caching and parallelization
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
