import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { join } from 'path';
import { createGitServer } from '../../src/server/git-server.js';
import { RepositoryManager } from '../../src/core/repository-manager.js';
import { TestRepository } from '../fixtures/test-repo.js';

describe('Worktree Lifecycle Integration', () => {
  let testRepo: TestRepository;
  let server: McpServer;

  beforeEach(async () => {
    testRepo = await TestRepository.create();
    await testRepo.writeFile('README.md', '# Test');
    await testRepo.commit('Initial commit');
    await testRepo.createBranch('feature');

    server = new McpServer(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    const repoManager = new RepositoryManager([testRepo.path]);
    createGitServer(server, repoManager);
  });

  afterEach(async () => {
    await testRepo.cleanup();
  });

  it('should complete worktree lifecycle', async () => {
    const worktreePath = join(testRepo.path, 'feature-worktree');

    const addHandler = (server as any)._registeredTools['git_worktree_add'].handler;
    const addResult = await addHandler({
      repository: testRepo.path,
      path: worktreePath,
      commitish: 'feature'
    });
    const addData = JSON.parse(addResult.content[0].text);
    expect(addData.success).toBe(true);

    const listHandler = (server as any)._registeredTools['git_worktree_list'].handler;
    const listResult = await listHandler({ repository: testRepo.path });
    const listData = JSON.parse(listResult.content[0].text);
    expect(listData.worktrees.length).toBeGreaterThanOrEqual(2);

    const removeHandler = (server as any)._registeredTools['git_worktree_remove'].handler;
    const removeResult = await removeHandler({
      repository: testRepo.path,
      path: worktreePath
    });
    const removeData = JSON.parse(removeResult.content[0].text);
    expect(removeData.success).toBe(true);
  });
});