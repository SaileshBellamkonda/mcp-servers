import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
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

  it('should register all 30 tools', () => {
    createGitServer(server, repoManager);

    const tools = Object.keys((server as any)._registeredTools);
    expect(tools).toHaveLength(30);
    // Original 14
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
    // Remote operations (8)
    expect(tools).toContain('git_fetch');
    expect(tools).toContain('git_pull');
    expect(tools).toContain('git_push');
    expect(tools).toContain('git_merge');
    expect(tools).toContain('git_rebase');
    expect(tools).toContain('git_stash');
    expect(tools).toContain('git_cherry_pick');
    expect(tools).toContain('git_tag');
    // History tools (5)
    expect(tools).toContain('git_blame');
    expect(tools).toContain('git_show');
    expect(tools).toContain('git_reflog');
    expect(tools).toContain('git_search');
    expect(tools).toContain('git_file_history');
    // Remote management (3)
    expect(tools).toContain('git_remote_list');
    expect(tools).toContain('git_remote_add');
    expect(tools).toContain('git_remote_remove');
  });

  it('should create core services', () => {
    createGitServer(server, repoManager);
    expect(Object.keys((server as any)._registeredTools).length).toBeGreaterThan(0);
  });
});
