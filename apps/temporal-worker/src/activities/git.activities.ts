import { Context } from '@temporalio/activity';
import { execSync } from 'child_process';

export interface GitDiffFile {
  path: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  oldPath?: string;
}

/**
 * Computes Git diff between two commits
 */
export async function computeGitDiff(
  projectRoot: string,
  baseSha: string,
  headSha: string
): Promise<GitDiffFile[]> {
  Context.current().heartbeat();

  try {
    // Execute git diff command
    const output = execSync(
      `git diff --name-status ${baseSha} ${headSha}`,
      {
        cwd: projectRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      }
    );

    // Parse the output
    const lines = output.trim().split('\n').filter(line => line.length > 0);
    const files: GitDiffFile[] = [];

    for (const line of lines) {
      const parts = line.split('\t');
      const statusCode = parts[0];
      const path = parts[1];

      let status: GitDiffFile['status'];
      let oldPath: string | undefined;

      // Map git status codes to semantic names
      if (statusCode === 'A') {
        status = 'added';
      } else if (statusCode === 'D') {
        status = 'deleted';
      } else if (statusCode === 'M') {
        status = 'modified';
      } else if (statusCode?.startsWith('R')) {
        // Renamed files: R100  old/path    new/path
        status = 'renamed';
        const newPath = parts[2];
        if (path && newPath) {
          oldPath = path;
          files.push({ path: newPath, status, oldPath });
        }
        continue;
      } else {
        // Unknown status, treat as modified
        status = 'modified';
      }

      if (path) {
        files.push({ path, status, oldPath });
      }
    }

    return files;
  } catch (error: any) {
    if (error.status === 128) {
      // Git command failed - likely invalid refs
      throw new Error(
        `Git diff failed: Invalid refs ${baseSha}..${headSha}. ${error.message}`
      );
    }
    throw new Error(`Git diff failed: ${error.message}`);
  }
}

/**
 * Gets the current Git branch name
 */
export async function getCurrentBranch(projectRoot: string): Promise<string> {
  Context.current().heartbeat();

  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: projectRoot,
      encoding: 'utf-8',
    }).trim();

    return branch;
  } catch (error: any) {
    throw new Error(`Failed to get current branch: ${error.message}`);
  }
}

/**
 * Gets the latest commit SHA
 */
export async function getLatestCommitSha(projectRoot: string): Promise<string> {
  Context.current().heartbeat();

  try {
    const sha = execSync('git rev-parse HEAD', {
      cwd: projectRoot,
      encoding: 'utf-8',
    }).trim();

    return sha;
  } catch (error: any) {
    throw new Error(`Failed to get latest commit SHA: ${error.message}`);
  }
}
