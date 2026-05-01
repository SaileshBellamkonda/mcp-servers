import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitServer } from '../../src/server/git-server.js';
import { RepositoryManager } from '../../src/core/repository-manager.js';
import { TestRepository } from '../fixtures/test-repo.js';

describe('Git Workflow Integration', () => {
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

  it('should complete full commit workflow', async () => {
    await testRepo.writeFile('test.ts', 'console.log("test");');

    const statusHandler = (server as any)._registeredTools['git_status'].handler;
    const statusResult = await statusHandler({ repository: testRepo.path });
    const status = JSON.parse(statusResult.content[0].text);

    expect(status.files).toHaveLength(1);
    expect(status.files[0].path).toBe('test.ts');
    expect(status.files[0].status).toBe('??');

    const addHandler = (server as any)._registeredTools['git_add'].handler;
    const addResult = await addHandler({
      repository: testRepo.path,
      files: ['test.ts']
    });
    const addData = JSON.parse(addResult.content[0].text);
    expect(addData.success).toBe(true);

    const commitHandler = (server as any)._registeredTools['git_commit'].handler;
    const commitResult = await commitHandler({
      repository: testRepo.path,
      message: 'test: add test file'
    });
    const commitData = JSON.parse(commitResult.content[0].text);
    expect(commitData.success).toBe(true);

    const logHandler = (server as any)._registeredTools['git_log'].handler;
    const logResult = await logHandler({ repository: testRepo.path, limit: 1 });
    const log = JSON.parse(logResult.content[0].text);
    expect(log.commits[0].message).toBe('test: add test file');
  });
});