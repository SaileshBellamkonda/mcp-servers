import type { McpServer } from '@modelcontextprotocol/server';
import { RepositoryManager } from '../core/repository-manager.js';
import { PathValidator } from '../core/path-validator.js';
import { GitExecutor } from '../core/git-executor.js';
import { OutputParser } from '../core/output-parser.js';
import type { Services } from '../core/types.js';
import type { McpLogger } from '../core/logger.js';

// Import all tool registration functions
import { registerGitWorkspaces } from '../tools/git-workspaces.js';
import { registerGitStatus } from '../tools/git-status.js';
import { registerGitLog } from '../tools/git-log.js';
import { registerGitBranch } from '../tools/git-branch.js';
import { registerGitDiff } from '../tools/git-diff.js';
import { registerGitAdd } from '../tools/git-add.js';
import { registerGitCommit } from '../tools/git-commit.js';
import { registerGitWorktreeList } from '../tools/worktree/git-worktree-list.js';
import { registerGitWorktreeAdd } from '../tools/worktree/git-worktree-add.js';
import { registerGitWorktreeRemove } from '../tools/worktree/git-worktree-remove.js';
import { registerGitWorktreePrune } from '../tools/worktree/git-worktree-prune.js';
import { registerGitWorktreeMove } from '../tools/worktree/git-worktree-move.js';
import { registerGitWorktreeLock } from '../tools/worktree/git-worktree-lock.js';
import { registerGitWorktreeUnlock } from '../tools/worktree/git-worktree-unlock.js';
import { registerGitFetch } from '../tools/git-fetch.js';
import { registerGitPull } from '../tools/git-pull.js';
import { registerGitPush } from '../tools/git-push.js';
import { registerGitMerge } from '../tools/git-merge.js';
import { registerGitRebase } from '../tools/git-rebase.js';
import { registerGitStash } from '../tools/git-stash.js';
import { registerGitCherryPick } from '../tools/git-cherry-pick.js';
import { registerGitTag } from '../tools/git-tag.js';
import { registerGitBlame } from '../tools/git-blame.js';
import { registerGitShow } from '../tools/git-show.js';
import { registerGitReflog } from '../tools/git-reflog.js';
import { registerGitSearch } from '../tools/git-search.js';
import { registerGitFileHistory } from '../tools/git-file-history.js';
import { registerGitRemoteList, registerGitRemoteAdd, registerGitRemoteRemove } from '../tools/git-remote.js';

/**
 * Create and configure Git MCP server with all tools
 */
export function createGitServer(
  server: McpServer,
  repoManager: RepositoryManager,
  logger?: McpLogger,
): void {
  // Create core services
  const pathValidator = new PathValidator(repoManager);
  const gitExecutor = new GitExecutor(logger);
  const outputParser = new OutputParser();

  const services: Services = {
    repoManager,
    pathValidator,
    gitExecutor,
    outputParser,
    ...(logger !== undefined && { logger }),
  };

  // Register all tools
  registerGitWorkspaces(server, services);
  registerGitStatus(server, services);
  registerGitLog(server, services);
  registerGitBranch(server, services);
  registerGitDiff(server, services);
  registerGitAdd(server, services);
  registerGitCommit(server, services);
  registerGitWorktreeList(server, services);
  registerGitWorktreeAdd(server, services);
  registerGitWorktreeRemove(server, services);
  registerGitWorktreePrune(server, services);
  registerGitWorktreeMove(server, services);
  registerGitWorktreeLock(server, services);
  registerGitWorktreeUnlock(server, services);
  registerGitFetch(server, services);
  registerGitPull(server, services);
  registerGitPush(server, services);
  registerGitMerge(server, services);
  registerGitRebase(server, services);
  registerGitStash(server, services);
  registerGitCherryPick(server, services);
  registerGitTag(server, services);
  registerGitBlame(server, services);
  registerGitShow(server, services);
  registerGitReflog(server, services);
  registerGitSearch(server, services);
  registerGitFileHistory(server, services);
  registerGitRemoteList(server, services);
  registerGitRemoteAdd(server, services);
  registerGitRemoteRemove(server, services);
}
