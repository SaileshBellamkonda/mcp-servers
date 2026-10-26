// Dependency-free: this file is also bundled, on its own, into dist/mcp-headers.js (the headersHelper script) and
// may import nothing but Node built-ins.
import { createHmac } from 'node:crypto';

const SERVER_ID = /^[a-z][a-z0-9-]{0,31}$/;

/** Server ids are plain lowercase words (`git`, `coderag`, `server-files`). */
export function isValidServerId(serverId: string): boolean {
  return SERVER_ID.test(serverId);
}

/**
 * The bearer token of one server: HMAC-SHA256 keyed with the workspace token over `mcp-servers:<serverId>`, as 64
 * hex characters. Every server of a workspace has its own token, so a process that squats one server's port and
 * receives that server's token from a client cannot use it against another server; the workspace token itself is
 * never sent to any server. The extension (to start a server) and the headers helper (to print the header) compute
 * it the same way.
 */
export function deriveServerToken(workspaceToken: string, serverId: string): string {
  if (!isValidServerId(serverId)) throw new Error('Invalid server id (expected a lowercase word such as "git")');
  return createHmac('sha256', workspaceToken).update(`mcp-servers:${serverId}`).digest('hex');
}
