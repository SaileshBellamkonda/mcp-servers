import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitServer } from '../../../src/server/git-server.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';

describe('createGitServer', () => {
  let server: McpServer;
  let repoManager: RepositoryManager;

  beforeEach(() => {
    server = new McpServer(
      { name: 'git-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    repoManager = new RepositoryManager(['/repo']);
  });

  it('should register all 14 tools', () => {
    createGitServer(server, repoManager);
    
    const tools = Object.keys((server as any)._registeredTools);
    expect(tools).toHaveLength(14);
    expect(tools).toContain('git_workspaces');
    expect(tools).toContain('git_status');
    expect(tools).toContain('git_log');
    expect(tools).toContain('git_branch');
    expect(tools).toContain('git_diff');
    expect(tools).toContain('git_add');
    expect(tools).toContain('git_commit');
    expect(tools).toContain('git_worktree_list');
    expect(tools).toContain('git_worktree_add');
    expect(tools).toContain('git_worktree_remove');
    expect(tools).toContain('git_worktree_prune');
    expect(tools).toContain('git_worktree_move');
    expect(tools).toContain('git_worktree_lock');
    expect(tools).toContain('git_worktree_unlock');
  });

  it('should create core services', () => {
    createGitServer(server, repoManager);
    expect(Object.keys((server as any)._registeredTools).length).toBeGreaterThan(0);
  });
});
