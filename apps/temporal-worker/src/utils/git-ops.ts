import { execSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Clone a git repository to a temporary directory
 * Returns the path to the cloned repository
 */
export function cloneRepository(gitRemoteUrl: string, branch: string = "main"): string {
	try {
		// Create a temporary directory
		const tempDir = mkdtempSync(join(tmpdir(), "perceo-git-"));

		console.log(`Cloning repository ${gitRemoteUrl} to ${tempDir}...`);

		// Clone the repository with depth=1 for faster cloning (we'll fetch full history after)
		execSync(`git clone --branch ${branch} ${gitRemoteUrl} ${tempDir}`, {
			encoding: "utf-8",
			maxBuffer: 50 * 1024 * 1024, // 50MB buffer
		});

		// Fetch full history (we need all commits for bootstrap)
		// If already full clone, this will safely do nothing
		try {
			execSync(`git fetch --unshallow`, {
				cwd: tempDir,
				encoding: "utf-8",
			});
		} catch (unshallowError) {
			// If repo is already full clone, unshallow will fail - that's fine
			console.log("Repository is already full clone or fetch failed, continuing...");
		}

		console.log(`Repository cloned successfully to ${tempDir}`);
		return tempDir;
	} catch (error) {
		console.error(`Failed to clone repository ${gitRemoteUrl}:`, error);
		throw error;
	}
}

/**
 * Clean up a cloned repository
 */
export function cleanupRepository(projectDir: string): void {
	try {
		console.log(`Cleaning up repository at ${projectDir}...`);
		rmSync(projectDir, { recursive: true, force: true });
		console.log(`Repository cleaned up successfully`);
	} catch (error) {
		console.error(`Failed to cleanup repository at ${projectDir}:`, error);
		// Don't throw - cleanup failures shouldn't fail the workflow
	}
}

/**
 * Get git diff between two commits
 */
export function getGitDiff(projectDir: string, baseSha: string, headSha: string): string {
	try {
		const diff = execSync(`git diff ${baseSha}...${headSha}`, {
			cwd: projectDir,
			encoding: "utf-8",
			maxBuffer: 10 * 1024 * 1024, // 10MB buffer
		});
		return diff;
	} catch (error) {
		console.error(`Failed to get git diff ${baseSha}...${headSha}:`, error);
		throw error;
	}
}

/**
 * Get all commit SHAs from repository in chronological order
 */
export function getAllCommits(projectDir: string, branch: string): string[] {
	try {
		const output = execSync(`git rev-list --first-parent ${branch} --reverse`, {
			cwd: projectDir,
			encoding: "utf-8",
			maxBuffer: 10 * 1024 * 1024,
		});

		return output
			.trim()
			.split("\n")
			.filter((sha) => sha.length > 0);
	} catch (error) {
		console.error(`Failed to get commit history for branch ${branch}:`, error);
		throw error;
	}
}

/**
 * Get file contents at specific commit
 */
export function getFileAtCommit(projectDir: string, commit: string, filePath: string): string {
	try {
		const content = execSync(`git show ${commit}:${filePath}`, {
			cwd: projectDir,
			encoding: "utf-8",
			maxBuffer: 10 * 1024 * 1024,
		});
		return content;
	} catch (error) {
		// File might not exist at this commit
		return "";
	}
}

/**
 * Get all files changed between two commits
 */
export function getChangedFiles(projectDir: string, baseSha: string, headSha: string): string[] {
	try {
		const output = execSync(`git diff --name-only ${baseSha}...${headSha}`, {
			cwd: projectDir,
			encoding: "utf-8",
		});

		return output
			.trim()
			.split("\n")
			.filter((file) => file.length > 0);
	} catch (error) {
		console.error(`Failed to get changed files ${baseSha}...${headSha}:`, error);
		return [];
	}
}

/**
 * Get current HEAD commit SHA
 */
export function getCurrentCommit(projectDir: string): string {
	try {
		const sha = execSync("git rev-parse HEAD", {
			cwd: projectDir,
			encoding: "utf-8",
		});
		return sha.trim();
	} catch (error) {
		console.error("Failed to get current commit:", error);
		throw error;
	}
}

/**
 * Split array into chunks
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += chunkSize) {
		chunks.push(array.slice(i, i + chunkSize));
	}
	return chunks;
}
