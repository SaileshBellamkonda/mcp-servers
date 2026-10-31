import type { McpServer } from '@modelcontextprotocol/server';
import { RepositoryManager } from '../core/repository-manager.ts';
import { PathValidator } from '../core/path-validator.ts';
import { GitExecutor } from '../core/git-executor.ts';
import { OutputParser } from '../core/output-parser.ts';
import type { Services, ServerLogger } from '../core/types.ts';

// Import all tool registration functions
import { registerGitWorkspaces } from '../tools/git-workspaces.ts';
import { registerGitStatus } from '../tools/git-status.ts';
import { registerGitLog } from '../tools/git-log.ts';
import { registerGitBranch } from '../tools/git-branch.ts';
import { registerGitDiff } from '../tools/git-diff.ts';
import { registerGitAdd } from '../tools/git-add.ts';
import { registerGitCommit } from '../tools/git-commit.ts';
import { registerGitWorktreeList } from '../tools/worktree/git-worktree-list.ts';
import { registerGitWorktreeAdd } from '../tools/worktree/git-worktree-add.ts';
import { registerGitWorktreeRemove } from '../tools/worktree/git-worktree-remove.ts';
import { registerGitWorktreePrune } from '../tools/worktree/git-worktree-prune.ts';
import { registerGitWorktreeMove } from '../tools/worktree/git-worktree-move.ts';
import { registerGitWorktreeLock } from '../tools/worktree/git-worktree-lock.ts';
import { registerGitWorktreeUnlock } from '../tools/worktree/git-worktree-unlock.ts';
import { registerGitFetch } from '../tools/git-fetch.ts';
import { registerGitPull } from '../tools/git-pull.ts';
import { registerGitPush } from '../tools/git-push.ts';
import { registerGitMerge } from '../tools/git-merge.ts';
import { registerGitRebase } from '../tools/git-rebase.ts';
import { registerGitStash } from '../tools/git-stash.ts';
import { registerGitCherryPick } from '../tools/git-cherry-pick.ts';
import { registerGitTag } from '../tools/git-tag.ts';
import { registerGitBlame } from '../tools/git-blame.ts';
import { registerGitShow } from '../tools/git-show.ts';
import { registerGitReflog } from '../tools/git-reflog.ts';
import { registerGitSearch } from '../tools/git-search.ts';
import { registerGitFileHistory } from '../tools/git-file-history.ts';
import { registerGitRemoteList, registerGitRemoteAdd, registerGitRemoteRemove } from '../tools/git-remote.ts';

/**
 * Create and configure Git MCP server with all tools
 */
export function createGitServer(
  server: McpServer,
  repoManager: RepositoryManager,
  logger?: ServerLogger,
): void {
  // Create core services
  const pathValidator = new PathValidator(repoManager);
  const gitExecutor = new GitExecutor(logger, repoManager);
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
