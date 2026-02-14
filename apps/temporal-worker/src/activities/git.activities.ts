import { getAllCommits, cloneRepository, cleanupRepository } from "../utils/git-ops";

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

	console.log(`Cloning repository: ${gitRemoteUrl} (branch: ${branch})`);

	const projectDir = cloneRepository(gitRemoteUrl, branch);

	console.log(`Repository cloned to: ${projectDir}`);

	return { projectDir };
}

/**
 * Clean up a cloned repository
 */
export async function cleanupRepositoryActivity(input: { projectDir: string }): Promise<void> {
	const { projectDir } = input;
	console.log(`Cleaning up repository: ${projectDir}`);
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

	console.log(`Getting commit history for ${projectDir} (branch: ${branch})`);

	const commits = getAllCommits(projectDir, branch);

	console.log(`Found ${commits.length} commits`);

	return commits;
}
