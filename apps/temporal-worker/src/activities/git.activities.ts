import { getAllCommits, cloneRepository, cleanupRepository } from "../utils/git-ops";
import { logger } from "../logger";

export interface CloneRepositoryInput {
	gitRemoteUrl: string;
	branch: string;
}

export interface CloneRepositoryOutput {
	projectDir: string;
}

/**
 * Clone a git repository to a temporary directory
 * Returns the path to the cloned repository
 */
export async function cloneRepositoryActivity(input: CloneRepositoryInput): Promise<CloneRepositoryOutput> {
	const { gitRemoteUrl, branch } = input;
	const log = logger.withActivity("cloneRepository");

	log.info("Cloning repository", { gitRemoteUrl, branch });

	const projectDir = cloneRepository(gitRemoteUrl, branch);

	log.info("Repository cloned", { projectDir, gitRemoteUrl, branch });

	return { projectDir };
}

/**
 * Clean up a cloned repository
 */
export async function cleanupRepositoryActivity(input: { projectDir: string }): Promise<void> {
	const { projectDir } = input;
	logger.info("Cleaning up repository", { activity: "cleanupRepository", projectDir });
	cleanupRepository(projectDir);
}

export interface GetCommitHistoryInput {
	projectDir: string;
	branch: string;
}

/**
 * Get all commit SHAs from repository in chronological order
 *
 * This activity is called once at the start of the workflow to get
 * the entire commit history. The workflow then loops through these
 * commits in chunks without additional activity calls.
 */
export async function getCommitHistoryActivity(input: GetCommitHistoryInput): Promise<string[]> {
	const { projectDir, branch } = input;
	const log = logger.withActivity("getCommitHistory");

	log.info("Getting commit history", { projectDir, branch });

	const commits = getAllCommits(projectDir, branch);

	log.info("Commit history retrieved", { projectDir, branch, commitCount: commits.length });

	return commits;
}
