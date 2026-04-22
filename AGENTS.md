# MCP Servers

## Project Overview

This repository is dedicated to building **MCP (Model Context Protocol) servers** with the additional capability of running inside Visual Studio Code extensions. The project enables dual-functionality where MCP servers can operate both as:

1. **Standalone servers** — Independent MCP servers that can be used with any MCP-compatible client
2. **VS Code extension components** — Integrated MCP servers that run directly within Visual Studio Code extensions

This dual-mode architecture allows developers to create MCP servers that are flexible, portable, and can be deployed in multiple contexts without code duplication.

**Key characteristics:**
- Built with TypeScript for type safety and modern JavaScript features
- Follows the Model Context Protocol specification
- Designed for both standalone and VS Code extension deployment
- Emphasizes reusability and modularity

## Mandatory Workflow

All development work in this repository MUST follow this workflow. No exceptions.

### 1. Design Before Code

**Skill:** `brainstorming`

Before creating any feature, component, or behavior change — no matter how simple — use the brainstorming skill to explore intent, requirements, and design. Output a spec to `docs/specs/`.

### 2. Plan Before Implementation

**Skill:** `writing-plans`

After a design is approved, create a detailed implementation plan with bite-sized TDD tasks. Output plans to `docs/plans/`. Plans must include exact file paths, test files, and verification steps.

### 3. Test-Driven Development

**Skill:** `test-driven-development`

All production code MUST be written test-first using Red-Green-Refactor:

1. **RED** — Write a failing test that describes the expected behavior
2. **GREEN** — Write the minimal code to make the test pass
3. **REFACTOR** — Clean up while keeping tests green

No production code without a failing test first. If code was written before its test, delete it and start over.

### 4. Verify Before Claiming Done

**Skill:** `verification-before-completion`

Never claim work is complete without fresh verification evidence. Run tests, linter, and build. Evidence before assertions, always.

### 5. Request Code Review

**Skill:** `requesting-code-review`

After completing tasks, major features, or before merging — request a code review to ensure quality and correctness.

## Skill Reference

> The `using-superpowers` skill governs skill discovery. Invoke it first to determine which other skill applies.

### Skill Discovery

| Skill | When to Use |
|---|---|
| `using-superpowers` | At the start of any task to determine which process or domain skill applies before taking action |

### Core Workflow (use in order)

| Skill | When to Use |
|---|---|
| `brainstorming` | Before ANY creative work — features, components, behavior changes |
| `writing-plans` | After design approval, before touching code |
| `test-driven-development` | During ALL implementation — new features, bug fixes, refactoring |
| `requesting-code-review` | After completing tasks, major features, or before merging |

### Quality & Troubleshooting

| Skill | When to Use |
|---|---|
| `systematic-debugging` | Any bug, test failure, or unexpected behavior — investigate root cause before fixing |

### Domain — MCP Servers

| Skill | When to Use |
|---|---|
| `mcp-builder` | Building or modifying MCP servers — use for all MCP server development |

## Technology Stack

- **Runtime:** Node.js (latest LTS recommended)
- **Language:** TypeScript (strict mode)
- **MCP SDK:** `@modelcontextprotocol/sdk` — import from `/server/mcp.js` and `/server/stdio.js`
- **VS Code Extension API:** `vscode` module for extension integration
- **Testing:** Vitest
- **Package manager:** pnpm

## Development Rules

1. **TDD is non-negotiable.** No production code without a failing test first.
2. **Follow the implementation plan.** Complete phases in order. Do not skip ahead.
3. **Do not add files, features, or abstractions not in the plan.**
4. **MCP SDK imports:** Use `@modelcontextprotocol/sdk` with `server.registerTool()` and `server.registerResource()` (not deprecated `.tool()` / `.resource()` overloads).
5. **Run verification steps** after every task. Fix failures before proceeding.
6. **Commit frequently** — after each passing task, not in bulk.
7. **Never use `git add -A` or `git add .`** — the workspace may contain unrelated files. Always stage files by explicit path using `git add <file1> <file2> ...`, only staging files that were created or modified as part of the current plan/task.
8. **Dual-mode design** — All MCP servers must be designed to work both as standalone servers and as VS Code extension components.

## Repository Structure

The repository structure will be established as MCP servers are developed. Typical structure may include:

```
src/
  servers/           # Individual MCP server implementations
  shared/            # Shared utilities and types
  vscode/            # VS Code extension integration code
tests/               # Test files
docs/
  DESIGN.md          # Design document
  ROADMAP.md         # Roadmap document
  specs/             # Design specifications
  plans/             # Implementation plans
  adr/               # Architecture Decision Records
```

## MCP Server Architecture

### Standalone Mode

In standalone mode, MCP servers:
- Run as independent processes
- Communicate via stdio or HTTP transport
- Can be used with any MCP-compatible client
- Follow standard MCP protocol specifications

### VS Code Extension Mode

In VS Code extension mode, MCP servers:
- Run within the VS Code extension host process
- Integrate with VS Code's extension API
- Can access VS Code workspace, editor, and UI features
- Maintain MCP protocol compatibility while leveraging VS Code capabilities

### Design Principles

1. **Protocol Compliance** — All servers must strictly follow the MCP specification
2. **Transport Abstraction** — Separate business logic from transport layer
3. **Mode Detection** — Servers should detect their runtime environment and adapt accordingly
4. **Shared Core Logic** — Business logic should be reusable across both modes
5. **Type Safety** — Leverage TypeScript for compile-time safety and better developer experience

## Plans

Use `docs/plans/` directory to store implementation plans. The `writing-plans` skill handles creation automatically.

## Specs

Use `docs/specs/` directory to store design specs. The `brainstorming` skill handles creation automatically.

## Getting Started

This is a new repository. To begin development:

1. **Define your first MCP server** — Use the `brainstorming` skill to design what your MCP server will do
2. **Create an implementation plan** — Use the `writing-plans` skill to break down the work
3. **Build with TDD** — Use the `test-driven-development` skill to implement
4. **Use the mcp-builder skill** — Leverage the MCP builder skill for guidance on creating high-quality MCP servers

## MCP Resources

- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/sdk)
- [VS Code Extension API](https://code.visualstudio.com/api)
