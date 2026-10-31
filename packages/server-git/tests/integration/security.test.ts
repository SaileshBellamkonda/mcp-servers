import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { createGitServer } from '../../src/server/git-server.ts';
import { RepositoryManager } from '../../src/core/repository-manager.ts';
import { TestRepository } from '../fixtures/test-repo.ts';
import { registeredTool } from '../fixtures/registered-tools.ts';

describe('Security Integration', () => {
  let testRepo: TestRepository;
  let server: McpServer;

  beforeEach(async () => {
    testRepo = await TestRepository.create();
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

  it('should reject path traversal in git_add', async () => {
    const addHandler = registeredTool(server, 'git_add').handler;

    await expect(
      addHandler({ repository: testRepo.path, files: ['../etc/passwd'] })
    ).rejects.toThrow();
  });

  it('should reject unauthorized repository access', async () => {
    const statusHandler = registeredTool(server, 'git_status').handler;

    await expect(
      statusHandler({ repository: '/unauthorized/repo' })
    ).rejects.toThrow();
  });

  it('should reject wildcard patterns in git_add', async () => {
    const addHandler = registeredTool(server, 'git_add').handler;

    await expect(
      addHandler({ repository: testRepo.path, files: ['.'] })
    ).rejects.toThrow();

    await expect(
      addHandler({ repository: testRepo.path, files: ['*'] })
    ).rejects.toThrow();
  });

  it('should sanitize commit messages', async () => {
    await testRepo.writeFile('test.ts', 'content');

    const addHandler = registeredTool(server, 'git_add').handler;
    await addHandler({ repository: testRepo.path, files: ['test.ts'] });

    const commitHandler = registeredTool(server, 'git_commit').handler;
    const result = await commitHandler({
      repository: testRepo.path,
      message: 'test\x00message\x1F'
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.message).not.toContain('\x00');
    expect(data.message).not.toContain('\x1F');
  });
});