import type { McpServer } from '@modelcontextprotocol/server';

export interface ToolContent {
  type: string;
  text: string;
}

export interface ToolResult {
  /** Non-empty: every handler returns at least one content item, so tests can read `content[0]` directly. */
  content: [ToolContent, ...ToolContent[]];
  isError?: boolean;
}

export interface RegisteredToolHandle {
  handler: (input: Record<string, unknown>) => Promise<ToolResult>;
}

/** The tools registered on `server`, read from the SDK's private registry so tests can call handlers without a transport. */
export function registeredTools(server: McpServer): Record<string, RegisteredToolHandle> {
  return (server as unknown as { _registeredTools: Record<string, RegisteredToolHandle> })._registeredTools;
}

/** One registered tool; throws when `name` was not registered. */
export function registeredTool(server: McpServer, name: string): RegisteredToolHandle {
  const tool = registeredTools(server)[name];
  if (tool === undefined) throw new Error(`Tool "${name}" is not registered`);
  return tool;
}
