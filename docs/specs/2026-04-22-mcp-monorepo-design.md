# MCP Monorepo Design Specification

**Date:** 2026-04-22  
**Status:** Approved  
**Version:** 1.0

## Executive Summary

This document specifies the comprehensive design for a monorepo structure that houses multiple MCP (Model Context Protocol) servers with dual-mode operation capabilities. Each MCP server can function both as a standalone server (for external MCP clients) and as an embedded component within VS Code extensions.

The architecture leverages modern tooling including pnpm workspaces, Vitest for testing, TypeScript project references, and Turbo for build orchestration. The design emphasizes modularity, reusability, type safety, and developer experience while maintaining strict protocol compliance.

## Table of Contents

1. [Overall Architecture & Root Structure](#1-overall-architecture--root-structure)
2. [MCP Server Package Structure](#2-mcp-server-package-structure)
3. [VS Code Extension Structure](#3-vs-code-extension-structure)
4. [Shared Packages Structure](#4-shared-packages-structure)
5. [Configuration & Tooling](#5-configuration--tooling)
6. [Build & Development Workflow](#6-build--development-workflow)
7. [Dependency Management & Documentation Structure](#7-dependency-management--documentation-structure)
8. [Naming Conventions, Scalability & Maintenance](#8-naming-conventions-scalability--maintenance)

---

## 1. Overall Architecture & Root Structure

### 1.1 Design Philosophy

The monorepo architecture is built on these core principles:

- **Dual-Mode Operation**: Every MCP server supports both standalone and embedded modes
- **Flat Workspace Structure**: Packages organized by type (servers, extensions, shared) for clarity
- **Scoped Packages**: All packages use `@mcp-servers/*` scope for namespace isolation
- **Layered Configuration**: Root-level base configs with package-level overrides
- **Type Safety First**: Strict TypeScript with project references for cross-package type checking
- **Modern Tooling**: pnpm for efficient dependency management, Vitest for fast testing
- **Protocol Compliance**: Strict adherence to MCP specification across all implementations

### 1.2 Root Directory Structure

```
mcp-servers/
├── .github/                    # GitHub workflows and templates
│   ├── workflows/
│   │   ├── ci.yml             # Continuous integration
│   │   ├── release.yml        # Release automation
│   │   └── test.yml           # Test execution
│   └── ISSUE_TEMPLATE/
├── .vscode/                    # VS Code workspace settings
│   ├── settings.json          # Workspace settings
│   ├── extensions.json        # Recommended extensions
│   └── launch.json            # Debug configurations
├── docs/                       # Documentation
│   ├── DESIGN.md              # Overall design document
│   ├── ROADMAP.md             # Project roadmap
│   ├── specs/                 # Design specifications
│   ├── plans/                 # Implementation plans
│   └── adr/                   # Architecture Decision Records
├── packages/                   # All workspace packages
│   ├── servers/               # MCP server implementations
│   ├── extensions/            # VS Code extensions
│   └── shared/                # Shared utilities and types
├── scripts/                    # Build and utility scripts
│   ├── build.ts               # Build orchestration
│   ├── test.ts                # Test runner
│   └── release.ts             # Release automation
├── .gitignore                  # Git ignore patterns
├── .npmrc                      # npm/pnpm configuration
├── AGENTS.md                   # Agent rules and workflow
├── package.json                # Root package.json (workspace config)
├── pnpm-workspace.yaml         # pnpm workspace definition
├── tsconfig.json               # Root TypeScript configuration
├── tsconfig.build.json         # Build-specific TypeScript config
├── vitest.config.ts            # Root Vitest configuration
├── turbo.json                  # Turbo build orchestration
└── README.md                   # Project overview
```

### 1.3 Root Package Configuration

The root `package.json` serves as the workspace coordinator and defines shared scripts:

```json
{
  "name": "mcp-servers",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.33.0",
  "engines": {
    "node": ">=22.13.0",
    "pnpm": ">=10.33.0"
  },
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "test:watch": "turbo run test:watch",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "clean": "turbo run clean && rimraf node_modules .turbo",
    "dev": "turbo run dev --parallel",
    "format": "prettier --write \"**/*.{ts,tsx,js,jsx,json,md}\"",
    "format:check": "prettier --check \"**/*.{ts,tsx,js,jsx,json,md}\"",
    "changeset": "changeset",
    "version-packages": "changeset version",
    "release": "pnpm build && changeset publish"
  },
  "devDependencies": {
    "@changesets/cli": "^2.27.1",
    "@types/node": "^22.13.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "eslint": "^9.0.0",
    "prettier": "^3.2.5",
    "rimraf": "^5.0.5",
    "turbo": "^2.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

### 1.4 Workspace Definition

The `pnpm-workspace.yaml` defines which directories contain packages:

```yaml
packages:
  - 'packages/servers/*'
  - 'packages/extensions/*'
  - 'packages/shared/*'
```

### 1.5 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Root Workspace                          │
│  (pnpm workspace, shared configs, build orchestration)       │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   Servers     │    │  Extensions   │    │    Shared     │
│   Package     │    │   Package     │    │   Packages    │
│  Directory    │    │  Directory    │    │  Directory    │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        │                     │                     │
   ┌────┴────┐           ┌────┴────┐          ┌────┴────┐
   │         │           │         │          │         │
   ▼         ▼           ▼         ▼          ▼         ▼
server-a  server-b   extension-a extension-b  types   utils
(MCP)     (MCP)      (VS Code)   (VS Code)   (shared) (shared)
```

---

## 2. MCP Server Package Structure

### 2.1 Server Package Philosophy

Each MCP server package is designed for dual-mode operation:

1. **Standalone Mode**: Runs as an independent process, communicates via stdio/HTTP
2. **Embedded Mode**: Runs within a VS Code extension, shares the extension's process

The architecture separates:
- **Core Logic**: Business logic, tool implementations, resource handlers (mode-agnostic)
- **Transport Layer**: Communication mechanism (stdio for standalone, direct calls for embedded)
- **Entry Points**: Separate entry points for each mode

### 2.2 Individual Server Package Structure

```
packages/servers/server-name/
├── src/
│   ├── index.ts                    # Main entry point (standalone mode)
│   ├── embedded.ts                 # Embedded mode entry point
│   ├── server.ts                   # Core server logic (mode-agnostic)
│   ├── tools/                      # Tool implementations
│   │   ├── index.ts               # Tool registry
│   │   ├── tool-one.ts            # Individual tool
│   │   └── tool-two.ts            # Individual tool
│   ├── resources/                  # Resource implementations
│   │   ├── index.ts               # Resource registry
│   │   └── resource-one.ts        # Individual resource
│   ├── types.ts                    # Server-specific types
│   └── utils.ts                    # Server-specific utilities
├── tests/
│   ├── server.test.ts              # Server core tests
│   ├── tools/
│   │   ├── tool-one.test.ts       # Tool unit tests
│   │   └── tool-two.test.ts
│   └── integration.test.ts         # Integration tests
├── package.json                     # Package configuration
├── tsconfig.json                    # TypeScript configuration
├── vitest.config.ts                 # Vitest configuration
└── README.md                        # Server documentation
```

### 2.3 Server Package.json Example

```json
{
  "name": "@mcp-servers/server-name",
  "version": "1.0.0",
  "type": "module",
  "description": "MCP server for [specific functionality]",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./embedded": {
      "types": "./dist/embedded.d.ts",
      "default": "./dist/embedded.js"
    }
  },
  "bin": {
    "server-name": "./dist/index.js"
  },
  "files": [
    "dist",
    "README.md"
  ],
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "dev": "tsc --project tsconfig.build.json --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src tests",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@mcp-servers/types": "workspace:*",
    "@mcp-servers/utils": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

### 2.4 Standalone Mode Entry Point

The `src/index.ts` file serves as the entry point for standalone mode:

```typescript
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
```

### 2.5 Embedded Mode Entry Point

The `src/embedded.ts` file provides the API for VS Code extensions:

**Note**: The embedded mode implementation uses an in-memory transport that handles MCP protocol messages without stdio. Tool handlers are registered separately for direct invocation, allowing VS Code extensions to call MCP tools synchronously without the overhead of stdio communication.

**Key Features**:
- **InMemoryTransport**: Lightweight transport for embedded mode that doesn't require stdio
- **Direct Tool Invocation**: Tools can be called directly via `callTool()` method
- **Tool Handler Registry**: Maintains a map of tool handlers for efficient lookup
- **Protocol Compliance**: Still uses MCP protocol internally for consistency

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createServer } from './server.js';

export interface EmbeddedServerOptions {
  workspaceRoot?: string;
  outputChannel?: any;
}

/**
 * In-memory transport for embedded mode.
 * Handles MCP protocol messages without stdio.
 */
class InMemoryTransport implements Transport {
  async start(): Promise<void> {
    // No-op for in-memory transport
  }

  async send(message: any): Promise<void> {
    // In embedded mode, messages are handled internally
    // This could be extended to support message logging or debugging
  }

  async close(): Promise<void> {
    // No-op for in-memory transport
  }
}

export class EmbeddedMCPServer {
  private server: Server;
  private transport: Transport;
  private toolHandlers: Map<string, (args: any) => Promise<any>> = new Map();

  constructor(options: EmbeddedServerOptions = {}) {
    this.server = createServer(options);
    this.transport = new InMemoryTransport();
    
    // Store tool handlers for direct invocation
    this.server.setRequestHandler('tools/call', async (request) => {
      const { name, arguments: args } = request.params as any;
      const handler = this.toolHandlers.get(name);
      if (!handler) {
        throw new Error(`Tool not found: ${name}`);
      }
      return await handler(args);
    });
  }

  async initialize(): Promise<void> {
    await this.server.connect(this.transport);
  }

  /**
   * Register a tool handler for direct invocation in embedded mode.
   */
  registerToolHandler(name: string, handler: (args: any) => Promise<any>): void {
    this.toolHandlers.set(name, handler);
  }

  /**
   * Call a tool directly in embedded mode.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    const handler = this.toolHandlers.get(name);
    if (!handler) {
      throw new Error(`Tool not found: ${name}`);
    }
    return await handler(args);
  }

  async close(): Promise<void> {
    await this.server.close();
  }
}

export function createEmbeddedServer(options?: EmbeddedServerOptions): EmbeddedMCPServer {
  return new EmbeddedMCPServer(options);
}
```

### 2.6 Core Server Logic

The `src/server.ts` contains mode-agnostic server logic:

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';

export interface ServerOptions {
  workspaceRoot?: string;
  outputChannel?: any;
}

export function createServer(options: ServerOptions = {}): Server {
  const server = new Server(
    {
      name: 'server-name',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  registerTools(server, options);
  registerResources(server, options);

  return server;
}
```

---

## 3. VS Code Extension Structure

### 3.1 Extension Package Philosophy

VS Code extensions in this monorepo:

1. **Embed MCP Servers**: Import and run MCP servers in embedded mode
2. **Provide UI**: Expose MCP functionality through VS Code UI
3. **Manage Lifecycle**: Handle server initialization and cleanup
4. **Bridge Contexts**: Connect MCP servers with VS Code APIs

### 3.2 Individual Extension Package Structure

```
packages/extensions/extension-name/
├── src/
│   ├── extension.ts                # Extension entry point
│   ├── server-manager.ts           # MCP server lifecycle management
│   ├── commands/                   # VS Code command implementations
│   │   ├── index.ts               # Command registry
│   │   └── command-one.ts         # Individual command
│   ├── views/                      # Custom views and webviews
│   │   ├── sidebar-view.ts        # Sidebar view provider
│   │   └── webview-panel.ts       # Webview panel
│   ├── config.ts                   # Configuration management
│   └── types.ts                    # Extension-specific types
├── tests/
│   ├── extension.test.ts           # Extension tests
│   └── commands/
│       └── command-one.test.ts    # Command tests
├── resources/                       # Static resources
│   ├── icons/                      # Extension icons
│   └── webview/                    # Webview assets
├── package.json                     # Extension manifest
├── tsconfig.json                    # TypeScript configuration
├── vitest.config.ts                 # Vitest configuration
└── README.md                        # Extension documentation
```

### 3.3 Extension Package.json Example

```json
{
  "name": "@mcp-servers/extension-name",
  "displayName": "Extension Display Name",
  "version": "1.0.0",
  "description": "VS Code extension for [specific functionality]",
  "publisher": "your-publisher-name",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "extension-name.commandOne",
        "title": "Command One"
      }
    ],
    "configuration": {
      "title": "Extension Name",
      "properties": {
        "extension-name.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Enable the extension"
        }
      }
    }
  },
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "dev": "tsc --project tsconfig.build.json --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src tests",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist",
    "package": "vsce package --no-dependencies",
    "publish": "vsce publish --no-dependencies"
  },
  "dependencies": {
    "@mcp-servers/server-name": "workspace:*",
    "@mcp-servers/types": "workspace:*",
    "@mcp-servers/utils": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "@types/vscode": "^1.85.0",
    "@vscode/vsce": "^2.22.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

### 3.4 Extension Entry Point

The `src/extension.ts` file is the main entry point:

```typescript
import * as vscode from 'vscode';
import { ServerManager } from './server-manager.js';
import { registerCommands } from './commands/index.js';

let serverManager: ServerManager;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Extension activating...');

  // Initialize MCP server manager
  serverManager = new ServerManager(context);
  await serverManager.initialize();

  // Register commands
  registerCommands(context, serverManager);

  console.log('Extension activated');
}

export async function deactivate() {
  if (serverManager) {
    await serverManager.dispose();
  }
}
```

### 3.5 Server Manager

The `src/server-manager.ts` manages the embedded MCP server lifecycle:

```typescript
import * as vscode from 'vscode';
import { createEmbeddedServer, EmbeddedMCPServer } from '@mcp-servers/server-name/embedded';

export class ServerManager {
  private server: EmbeddedMCPServer | null = null;
  private outputChannel: vscode.OutputChannel;

  constructor(private context: vscode.ExtensionContext) {
    this.outputChannel = vscode.window.createOutputChannel('MCP Server');
  }

  async initialize(): Promise<void> {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      
      this.server = createEmbeddedServer({
        workspaceRoot,
        outputChannel: this.outputChannel
      });

      await this.server.initialize();
      this.outputChannel.appendLine('MCP Server initialized successfully');
    } catch (error) {
      this.outputChannel.appendLine(`Failed to initialize server: ${error}`);
      throw error;
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    if (!this.server) {
      throw new Error('Server not initialized');
    }
    return await this.server.callTool(name, args);
  }

  async dispose(): Promise<void> {
    if (this.server) {
      await this.server.close();
      this.server = null;
    }
    this.outputChannel.dispose();
  }
}
```

---

## 4. Shared Packages Structure

### 4.1 Shared Package Philosophy

Shared packages provide reusable code across servers and extensions:

- **@mcp-servers/types**: Common TypeScript types and interfaces
- **@mcp-servers/utils**: Utility functions and helpers
- **@mcp-servers/testing**: Testing utilities and fixtures

### 4.2 Types Package Structure

```
packages/shared/types/
├── src/
│   ├── index.ts                    # Main exports
│   ├── mcp.ts                      # MCP protocol types
│   ├── server.ts                   # Server-related types
│   ├── extension.ts                # Extension-related types
│   └── common.ts                   # Common utility types
├── tests/
│   └── types.test.ts               # Type tests
├── package.json
├── tsconfig.json
└── README.md
```

### 4.3 Types Package.json

```json
{
  "name": "@mcp-servers/types",
  "version": "1.0.0",
  "type": "module",
  "description": "Shared TypeScript types for MCP servers",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "dev": "tsc --project tsconfig.build.json --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

### 4.4 Utils Package Structure

```
packages/shared/utils/
├── src/
│   ├── index.ts                    # Main exports
│   ├── fs.ts                       # File system utilities
│   ├── validation.ts               # Validation helpers
│   ├── logging.ts                  # Logging utilities
│   └── errors.ts                   # Error handling
├── tests/
│   ├── fs.test.ts
│   ├── validation.test.ts
│   └── logging.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

### 4.5 Testing Package Structure

The testing package provides shared testing utilities, fixtures, and helpers:

```
packages/shared/testing/
├── src/
│   ├── index.ts                    # Main exports
│   ├── fixtures.ts                 # Test fixtures and mock data
│   ├── mcp-test-utils.ts           # MCP-specific test utilities
│   ├── server-harness.ts           # Test harness for MCP servers
│   └── matchers.ts                 # Custom Vitest matchers
├── tests/
│   └── test-utils.test.ts          # Tests for test utilities
├── package.json
├── tsconfig.json
└── README.md
```

### 4.6 Testing Package.json

```json
{
  "name": "@mcp-servers/testing",
  "version": "1.0.0",
  "type": "module",
  "description": "Shared testing utilities for MCP servers",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "dev": "tsc --project tsconfig.build.json --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@mcp-servers/types": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  },
  "peerDependencies": {
    "vitest": "^2.0.0"
  }
}
```

---

## 5. Configuration & Tooling

### 5.1 Root TypeScript Configuration

The `tsconfig.json` at the root provides base configuration:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "incremental": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

### 5.2 Build TypeScript Configuration

The `tsconfig.build.json` extends the base for production builds:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "sourceMap": false,
    "declarationMap": false
  },
  "references": [
    { "path": "./packages/shared/types" },
    { "path": "./packages/shared/utils" },
    { "path": "./packages/servers/server-name" },
    { "path": "./packages/extensions/extension-name" }
  ]
}
```

### 5.3 Package-Level TypeScript Configuration

Each package has its own `tsconfig.json` that extends the root:

```json
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../../shared/types" },
    { "path": "../../shared/utils" }
  ]
}
```

### 5.4 Vitest Configuration

The root `vitest.config.ts` provides base test configuration:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.config.ts'
      ]
    },
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'dist']
  }
});
```

### 5.5 Turbo Configuration

The `turbo.json` orchestrates build tasks across packages:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"]
    },
    "lint": {
      "outputs": []
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "clean": {
      "cache": false
    }
  }
}
```

### 5.6 ESLint Configuration

Root `.eslintrc.json` for consistent code style:

```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": 2022,
    "sourceType": "module",
    "project": "./tsconfig.json"
  },
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking"
  ],
  "rules": {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/explicit-function-return-type": "off"
  },
  "ignorePatterns": ["dist", "node_modules", "*.config.ts"]
}
```

### 5.7 Prettier Configuration

Root `.prettierrc.json` for code formatting:

```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "arrowParens": "always"
}
```

### 5.8 NPM Configuration

The `.npmrc` file configures pnpm behavior:

```
# Use workspace protocol for local dependencies
link-workspace-packages=true

# Hoist dependencies to root when possible
hoist=true

# Strict peer dependencies
strict-peer-dependencies=false

# Save exact versions
save-exact=true

# Auto-install peers
auto-install-peers=true
```

---

## 6. Build & Development Workflow

### 6.1 Build Process Overview

The build process follows this sequence:

1. **Clean**: Remove previous build artifacts
2. **Type Generation**: Build shared types package first
3. **Shared Packages**: Build utils and other shared packages
4. **Servers**: Build MCP server packages
5. **Extensions**: Build VS Code extension packages
6. **Verification**: Run type checking and tests

### 6.2 Build Orchestration with Turbo

Turbo automatically handles:
- **Dependency ordering**: Builds packages in correct order based on dependencies
- **Caching**: Skips unchanged packages
- **Parallelization**: Builds independent packages concurrently
- **Incremental builds**: Only rebuilds what changed

Example build execution:

```bash
# Build all packages
pnpm build

# Turbo resolves to:
# 1. Build @mcp-servers/types (no dependencies)
# 2. Build @mcp-servers/utils (depends on types)
# 3. Build servers in parallel (depend on types, utils)
# 4. Build extensions in parallel (depend on servers, types, utils)
```

### 6.3 Development Workflow

#### Starting Development

```bash
# Install dependencies
pnpm install

# Start all packages in watch mode
pnpm dev

# Or start specific package
pnpm --filter @mcp-servers/server-name dev
```

#### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests for specific package
pnpm --filter @mcp-servers/server-name test
```

#### Type Checking

```bash
# Type check all packages
pnpm typecheck

# Type check specific package
pnpm --filter @mcp-servers/server-name typecheck
```

#### Linting and Formatting

```bash
# Lint all packages
pnpm lint

# Format all files
pnpm format

# Check formatting without changes
pnpm format:check
```

### 6.4 Package Scripts Reference

Each package supports these standard scripts:

- `build`: Compile TypeScript to JavaScript
- `dev`: Watch mode for development
- `test`: Run tests once
- `test:watch`: Run tests in watch mode
- `lint`: Run ESLint
- `typecheck`: Type check without emitting files
- `clean`: Remove build artifacts

### 6.5 Dependency Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Build Order                           │
└─────────────────────────────────────────────────────────┘

Level 1 (No dependencies):
  @mcp-servers/types
         │
         ▼
Level 2 (Depends on types):
  @mcp-servers/utils
         │
         ▼
Level 3 (Depends on types + utils):
  ┌──────────────────┬──────────────────┐
  │                  │                  │
  ▼                  ▼                  ▼
@mcp-servers/    @mcp-servers/    @mcp-servers/
server-a         server-b         server-c
  │                  │                  │
  └──────────────────┴──────────────────┘
                     │
                     ▼
Level 4 (Depends on servers + shared):
  ┌──────────────────┬──────────────────┐
  │                  │                  │
  ▼                  ▼                  ▼
@mcp-servers/    @mcp-servers/    @mcp-servers/
extension-a      extension-b      extension-c
```

### 6.6 Hybrid Build Outputs

The monorepo uses a hybrid approach for build outputs:

**Package-Level Builds** (default):
- Each package builds to its own `dist/` directory
- Enables independent versioning and publishing
- Supports workspace protocol for local development

**Root-Level Builds** (for bundled extensions):
- Extensions can optionally bundle to root `dist/` for VSIX packaging
- Includes all dependencies in single output
- Configured via extension-specific build scripts

Example extension build script for bundling:

```json
{
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "build:bundle": "node ../../scripts/bundle-extension.js"
  }
}
```

---

## 7. Dependency Management & Documentation Structure

### 7.1 Dependency Strategy

#### Workspace Dependencies

Use `workspace:*` protocol for internal dependencies:

```json
{
  "dependencies": {
    "@mcp-servers/types": "workspace:*",
    "@mcp-servers/utils": "workspace:*"
  }
}
```

Benefits:
- Always uses local version during development
- Automatically resolves to published version on release
- Type checking works across packages
- Hot reload in watch mode

#### External Dependencies

**Shared Dependencies** (installed at root):
- TypeScript
- Vitest
- ESLint
- Prettier
- Turbo

**Package-Specific Dependencies**:
- MCP SDK (`@modelcontextprotocol/sdk`)
- VS Code API (`@types/vscode`)
- Package-specific libraries

### 7.2 Version Management

Use Changesets for version management:

```bash
# Create a changeset
pnpm changeset

# Version packages based on changesets
pnpm version-packages

# Publish to npm
pnpm release
```

Changeset workflow:
1. Developer creates changeset describing changes
2. CI validates changeset exists for PRs
3. On merge, changesets accumulate
4. Release PR created automatically
5. Merge release PR to publish

### 7.3 Documentation Structure

```
docs/
├── DESIGN.md                       # Overall design document
├── ROADMAP.md                      # Project roadmap
├── specs/                          # Design specifications
│   ├── 2026-04-22-mcp-monorepo-design.md
│   └── [feature-name].md
├── plans/                          # Implementation plans
│   └── [feature-name]-plan.md
├── adr/                            # Architecture Decision Records
│   ├── 001-monorepo-structure.md
│   ├── 002-dual-mode-servers.md
│   └── 003-build-orchestration.md
└── guides/                         # Developer guides
    ├── getting-started.md
    ├── creating-server.md
    ├── creating-extension.md
    └── testing-guide.md
```

### 7.4 Package README Structure

Each package should have a comprehensive README:

```markdown
# @mcp-servers/package-name

Brief description of the package.

## Installation

\`\`\`bash
pnpm add @mcp-servers/package-name
\`\`\`

## Usage

### Standalone Mode

\`\`\`bash
npx @mcp-servers/package-name
\`\`\`

### Embedded Mode

\`\`\`typescript
import { createEmbeddedServer } from '@mcp-servers/package-name/embedded';

const server = createEmbeddedServer();
await server.initialize();
\`\`\`

## API Reference

[Detailed API documentation]

## Development

\`\`\`bash
pnpm install
pnpm build
pnpm test
\`\`\`

## License

MIT
```

---

## 8. Naming Conventions, Scalability & Maintenance

### 8.1 Naming Conventions

#### Package Names

**Format**: `@mcp-servers/[type]-[name]`

**Servers**:
- `@mcp-servers/server-filesystem`
- `@mcp-servers/server-database`
- `@mcp-servers/server-api`

**Extensions**:
- `@mcp-servers/extension-filesystem`
- `@mcp-servers/extension-database`
- `@mcp-servers/extension-api`

**Shared Packages**:
- `@mcp-servers/types`
- `@mcp-servers/utils`
- `@mcp-servers/testing`

#### Directory Names

- Use kebab-case: `server-name`, `extension-name`
- Match package name without scope: `@mcp-servers/server-name` → `packages/servers/server-name/`
- Be descriptive but concise

#### File Names

- Use kebab-case: `server-manager.ts`, `tool-registry.ts`
- Test files: `*.test.ts`
- Type definition files: `types.ts` or `*.types.ts`
- Configuration files: `*.config.ts`

#### Code Naming

**Classes**: PascalCase
```typescript
class ServerManager {}
class EmbeddedMCPServer {}
```

**Interfaces/Types**: PascalCase
```typescript
interface ServerOptions {}
type ToolHandler = () => void;
```

**Functions/Variables**: camelCase
```typescript
function createServer() {}
const serverInstance = null;
```

**Constants**: UPPER_SNAKE_CASE
```typescript
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT = 5000;
```

### 8.2 Scalability Considerations

#### Adding New Servers

1. Create package directory: `packages/servers/server-new/`
2. Copy template structure from existing server
3. Update `package.json` with correct name and dependencies
4. Implement server logic following dual-mode pattern
5. Add tests
6. Update root `tsconfig.build.json` references
7. Document in README

#### Adding New Extensions

1. Create package directory: `packages/extensions/extension-new/`
2. Copy template structure from existing extension
3. Update `package.json` with VS Code manifest
4. Implement extension activation and commands
5. Add tests
6. Update root `tsconfig.build.json` references
7. Document in README

#### Adding New Shared Packages

1. Create package directory: `packages/shared/package-name/`
2. Implement shared functionality
3. Export public API from `index.ts`
4. Add comprehensive tests
5. Update dependent packages
6. Document API

### 8.3 Maintenance Guidelines

#### Code Quality

- **Test Coverage**: Maintain >80% coverage for all packages
- **Type Safety**: Use strict TypeScript, avoid `any`
- **Documentation**: Document all public APIs
- **Code Review**: Require reviews for all changes

#### Dependency Updates

```bash
# Check for outdated dependencies
pnpm outdated

# Update dependencies interactively
pnpm update --interactive

# Update specific package
pnpm update @modelcontextprotocol/sdk --latest
```

#### Breaking Changes

When making breaking changes:
1. Create changeset with major version bump
2. Document migration path in CHANGELOG
3. Update all affected packages
4. Provide migration guide
5. Consider deprecation period

#### Performance Monitoring

- Monitor build times with Turbo
- Track test execution time
- Profile server performance
- Optimize bundle sizes for extensions

### 8.4 CI/CD Pipeline

#### GitHub Actions Workflow

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 10.33.0
      - uses: actions/setup-node@v4
        with:
          node-version: '22.13.0'
          cache: 'pnpm'
      
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      
      - name: Type check
        run: pnpm typecheck
      
      - name: Lint
        run: pnpm lint
      
      - name: Test
        run: pnpm test
      
      - name: Build
        run: pnpm build
```

#### Release Workflow

```yaml
name: Release

on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
      
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      
      - name: Build
        run: pnpm build
      
      - name: Create Release PR or Publish
        uses: changesets/action@v1
        with:
          publish: pnpm release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### 8.5 Troubleshooting Common Issues

#### Build Failures

**Issue**: TypeScript can't find types from workspace packages
**Solution**: Ensure TypeScript project references are configured correctly

```json
{
  "references": [
    { "path": "../../shared/types" }
  ]
}
```

**Issue**: Turbo cache causing stale builds
**Solution**: Clear Turbo cache

```bash
pnpm clean
rm -rf .turbo
pnpm build
```

#### Dependency Issues

**Issue**: Peer dependency warnings
**Solution**: Install peer dependencies or configure `.npmrc`

```
strict-peer-dependencies=false
```

**Issue**: Workspace protocol not resolving
**Solution**: Ensure package is built before dependent packages

```bash
pnpm --filter @mcp-servers/types build
pnpm --filter @mcp-servers/server-name build
```

#### Extension Issues

**Issue**: Extension not activating
**Solution**: Check activation events in `package.json`

```json
{
  "activationEvents": ["onStartupFinished"]
}
```

**Issue**: Server not initializing in embedded mode
**Solution**: Verify server manager initialization in `activate()` and ensure tool handlers are registered

```typescript
// In server.ts, register tools with handlers
export function createServer(options: ServerOptions = {}): Server {
  const server = new Server(/* ... */);
  
  // Register tools
  server.setRequestHandler('tools/list', async () => {
    return { tools: [/* tool definitions */] };
  });
  
  return server;
}
```

**Issue**: Tool calls failing in embedded mode
**Solution**: Ensure tool handlers are properly registered in the embedded server instance using `registerToolHandler()`

---

### 8.6 Best Practices Summary

1. **Follow TDD**: Write tests before implementation
2. **Use Workspace Protocol**: For all internal dependencies
3. **Maintain Type Safety**: Strict TypeScript everywhere
4. **Document Public APIs**: Clear documentation for all exports
5. **Version Consistently**: Use changesets for all releases
6. **Test Both Modes**: Test servers in standalone and embedded modes
7. **Keep Packages Focused**: Single responsibility per package
8. **Optimize Builds**: Leverage Turbo caching
9. **Monitor Performance**: Track build and test times
10. **Review Regularly**: Code review all changes

---

## Appendix A: Debug Configurations

### VS Code Launch Configurations

Add these configurations to `.vscode/launch.json` for debugging:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug MCP Server (Standalone)",
      "type": "node",
      "request": "launch",
      "runtimeArgs": ["-r", "ts-node/register"],
      "args": ["${workspaceFolder}/packages/servers/server-name/src/index.ts"],
      "cwd": "${workspaceFolder}/packages/servers/server-name",
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen",
      "skipFiles": ["<node_internals>/**"]
    },
    {
      "name": "Debug VS Code Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}/packages/extensions/extension-name"
      ],
      "outFiles": [
        "${workspaceFolder}/packages/extensions/extension-name/dist/**/*.js"
      ],
      "preLaunchTask": "npm: build"
    },
    {
      "name": "Debug Server Tests",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@mcp-servers/server-name", "test"],
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    },
    {
      "name": "Debug Current Test File",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["vitest", "run", "${file}"],
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

### Debugging Tips

**Standalone MCP Server**:
1. Set breakpoints in server code
2. Run "Debug MCP Server (Standalone)" configuration
3. Server will start and wait for stdio input
4. Use MCP client to send requests

**VS Code Extension**:
1. Build the extension: `pnpm --filter @mcp-servers/extension-name build`
2. Set breakpoints in extension code
3. Run "Debug VS Code Extension" configuration
4. New VS Code window opens with extension loaded
5. Trigger extension commands to hit breakpoints

**Tests**:
1. Set breakpoints in test files
2. Run "Debug Server Tests" or "Debug Current Test File"
3. Tests execute with debugger attached

---

## Appendix B: Quick Reference

### Common Commands

```bash
# Setup
pnpm install                                    # Install all dependencies

# Development
pnpm dev                                        # Start all packages in watch mode
pnpm --filter @mcp-servers/server-name dev     # Start specific package

# Building
pnpm build                                      # Build all packages
pnpm --filter @mcp-servers/server-name build   # Build specific package

# Testing
pnpm test                                       # Run all tests
pnpm test:watch                                 # Run tests in watch mode
pnpm --filter @mcp-servers/server-name test    # Test specific package

# Quality
pnpm lint                                       # Lint all packages
pnpm typecheck                                  # Type check all packages
pnpm format                                     # Format all files

# Versioning
pnpm changeset                                  # Create changeset
pnpm version-packages                           # Version packages
pnpm release                                    # Build and publish

# Cleanup
pnpm clean                                      # Clean all build artifacts
```

### Package Structure Template

```
packages/[type]/[name]/
├── src/
│   ├── index.ts
│   └── [implementation files]
├── tests/
│   └── [test files]
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

### File Naming Patterns

- Source files: `kebab-case.ts`
- Test files: `kebab-case.test.ts`
- Type files: `types.ts` or `kebab-case.types.ts`
- Config files: `kebab-case.config.ts`

---

## Appendix C: Migration Guide

### Migrating Existing MCP Server to Monorepo

1. **Create Package Directory**
   ```bash
   mkdir -p packages/servers/server-name
   ```

2. **Copy Source Files**
   ```bash
   cp -r existing-server/src packages/servers/server-name/
   ```

3. **Create Package.json**
   - Use template from section 2.3
   - Update name, description, dependencies

4. **Refactor for Dual-Mode**
   - Split `index.ts` into standalone entry point
   - Create `embedded.ts` for embedded mode
   - Extract core logic to `server.ts`

5. **Add Tests**
   - Copy existing tests
   - Add embedded mode tests

6. **Update Dependencies**
   - Change to workspace protocol for shared packages
   - Update import paths

7. **Verify Build**
   ```bash
   pnpm --filter @mcp-servers/server-name build
   pnpm --filter @mcp-servers/server-name test
   ```

---

## Conclusion

This design specification provides a comprehensive blueprint for implementing a scalable, maintainable monorepo structure for MCP servers with dual-mode operation. The architecture emphasizes:

- **Modularity**: Clear separation of concerns across packages
- **Reusability**: Shared packages for common functionality
- **Type Safety**: Strict TypeScript with project references
- **Developer Experience**: Modern tooling and efficient workflows
- **Scalability**: Easy to add new servers and extensions
- **Maintainability**: Consistent patterns and best practices

By following this specification, developers can create MCP servers that work seamlessly both as standalone servers and as embedded components within VS Code extensions, while maintaining code quality, type safety, and development velocity.

---

**Document Version**: 1.0  
**Last Updated**: 2026-04-22  
**Status**: Approved for Implementation
