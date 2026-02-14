import { execSync } from "node:child_process";
import chalk from "chalk";
import ora from "ora";
import { createPublicKey } from "node:crypto";

/**
 * GitHub OAuth configuration for Perceo CLI
 * TODO: Replace with actual GitHub OAuth App client ID
 * Create at: https://github.com/settings/developers
 */
const GITHUB_CLIENT_ID = process.env.PERCEO_GITHUB_CLIENT_ID || "";

export interface GitHubAuth {
	accessToken: string;
	tokenType: string;
}

export interface GitHubRemote {
	owner: string;
	repo: string;
}

/**
 * Authorize with GitHub using device flow (perfect for CLI apps).
 * Shows user a code and URL to authorize in their browser.
 */
export async function authorizeGitHub(): Promise<GitHubAuth> {
	if (!GITHUB_CLIENT_ID) {
		throw new Error("GitHub OAuth client ID not configured. Set PERCEO_GITHUB_CLIENT_ID environment variable.");
	}

	const spinner = ora("Requesting device authorization...").start();

	// Step 1: Request device and user codes
	let deviceResponse: Response;
	try {
		deviceResponse = await fetch("https://github.com/login/device/code", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({
				client_id: GITHUB_CLIENT_ID,
				scope: "repo",
			}),
		});
	} catch (fetchError) {
		spinner.fail("Failed to connect to GitHub");
		throw new Error(`Network error connecting to GitHub: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
	}

	if (!deviceResponse.ok) {
		spinner.fail("Failed to request device code");
		throw new Error(`GitHub API error: ${deviceResponse.statusText}`);
	}

	const deviceData = await deviceResponse.json();
	const { device_code, user_code, verification_uri, expires_in, interval = 5 } = deviceData;

	spinner.succeed("Device code received");

	// Step 2: Show user the code and URL
	console.log("\n" + chalk.bold.yellow("GitHub Authorization Required"));
	console.log(chalk.gray("─".repeat(50)));
	console.log("\n  1. Visit: " + chalk.cyan.underline(verification_uri));
	console.log("  2. Enter code: " + chalk.bold.green(user_code));
	console.log("\n" + chalk.gray("  Waiting for you to authorize in your browser..."));
	console.log(chalk.gray("─".repeat(50)) + "\n");

	// Step 3: Poll for authorization
	const startTime = Date.now();
	const expiresAt = startTime + expires_in * 1000;

	while (Date.now() < expiresAt) {
		await new Promise((resolve) => setTimeout(resolve, interval * 1000));

		let tokenResponse: Response;
		try {
			tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					client_id: GITHUB_CLIENT_ID,
					device_code,
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				}),
			});
		} catch (fetchError) {
			// Network error during polling, continue to retry
			console.log(chalk.yellow(`\n  Warning: Network error polling GitHub, retrying...`));
			continue;
		}

		const tokenData = await tokenResponse.json();

		if (tokenData.access_token) {
			console.log(chalk.green("✓ GitHub authorization successful!\n"));
			return {
				accessToken: tokenData.access_token,
				tokenType: tokenData.token_type || "bearer",
			};
		}

		if (tokenData.error === "authorization_pending") {
			// Still waiting for user to authorize
			continue;
		}

		if (tokenData.error === "slow_down") {
			// GitHub asked us to slow down
			await new Promise((resolve) => setTimeout(resolve, 5000));
			continue;
		}

		if (tokenData.error) {
			throw new Error(`GitHub authorization failed: ${tokenData.error_description || tokenData.error}`);
		}
	}

	throw new Error("GitHub authorization timed out. Please try again.");
}

/**
 * Create or update a repository secret using the GitHub API.
 * The secret is encrypted before being sent to GitHub.
 */
export async function createRepositorySecret(token: string, owner: string, repo: string, secretName: string, secretValue: string): Promise<void> {
	// Step 1: Get the repository's public key for encrypting secrets
	let keyResponse: Response;
	try {
		keyResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/public-key`, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
		});
	} catch (fetchError) {
		throw new Error(`Network error connecting to GitHub API: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
	}

	if (!keyResponse.ok) {
		const error = await keyResponse.text();
		throw new Error(`Failed to get repository public key: ${error}`);
	}

	const { key: publicKey, key_id: keyId } = await keyResponse.json();

	// Step 2: Encrypt the secret value using sodium (libsodium)
	const encryptedValue = await encryptSecret(secretValue, publicKey);

	// Step 3: Create or update the secret
	let secretResponse: Response;
	try {
		secretResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/${secretName}`, {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				encrypted_value: encryptedValue,
				key_id: keyId,
			}),
		});
	} catch (fetchError) {
		throw new Error(`Network error creating repository secret: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
	}

	if (!secretResponse.ok) {
		const error = await secretResponse.text();
		throw new Error(`Failed to create repository secret: ${error}`);
	}
}

/**
 * Encrypt a secret value using GitHub's public key.
 * Uses the same algorithm as GitHub CLI (libsodium sealed box).
 */
async function encryptSecret(secretValue: string, publicKeyBase64: string): Promise<string> {
	// GitHub uses libsodium sealed boxes for secret encryption
	// We need to use the same algorithm - this requires sodium-native or tweetnacl
	// For now, we'll use a Node.js native approach with Web Crypto API

	try {
		// Import the public key
		const publicKeyBuffer = Buffer.from(publicKeyBase64, "base64");

		// For GitHub Actions secrets, we need to use libsodium's crypto_box_seal
		// This is not directly available in Node.js crypto, so we'll use tweetnacl
		// which is a pure JS implementation
		const sodium = await import("tweetnacl");
		const { box, randomBytes } = sodium.default;

		// Convert strings to Uint8Array
		const messageBytes = new TextEncoder().encode(secretValue);
		const publicKeyBytes = new Uint8Array(publicKeyBuffer);

		// crypto_box_seal is a sealed box: anonymously send messages to a recipient
		// It's crypto_box with an ephemeral keypair
		const ephemeralKeyPair = box.keyPair();
		const nonce = randomBytes(box.nonceLength);
		const encrypted = box(messageBytes, nonce, publicKeyBytes, ephemeralKeyPair.secretKey);

		// Combine ephemeral public key + nonce + ciphertext
		const combined = new Uint8Array(ephemeralKeyPair.publicKey.length + nonce.length + encrypted.length);
		combined.set(ephemeralKeyPair.publicKey);
		combined.set(nonce, ephemeralKeyPair.publicKey.length);
		combined.set(encrypted, ephemeralKeyPair.publicKey.length + nonce.length);

		return Buffer.from(combined).toString("base64");
	} catch (error) {
		throw new Error(`Failed to encrypt secret. Install tweetnacl: npm install tweetnacl\n` + `Error: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Check if the given directory is inside a git repository.
 */
export function isGitRepository(projectDir: string): boolean {
	try {
		execSync("git rev-parse --is-inside-work-tree", {
			cwd: projectDir,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "ignore"],
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * Parse a git remote URL and return GitHub owner/repo if it's a GitHub URL.
 * Supports HTTPS, SSH with github.com, and SSH with custom host aliases (e.g. git@github-personal:owner/repo).
 */
function parseGitHubRemoteUrl(url: string): GitHubRemote | null {
	const trimmed = url.trim();
	// HTTPS and SSH with explicit github.com: https://github.com/owner/repo, git@github.com:owner/repo
	let match = trimmed.match(/github\.com[/:]([\w-]+)\/([\w.-]+?)(\.git)?$/);
	if (match && match[1] && match[2]) {
		return { owner: match[1], repo: match[2] };
	}
	// SSH with any host that contains "github" (e.g. github.com, github-personal, github-work)
	// Format: git@<host>:owner/repo or git@<host>:owner/repo.git
	match = trimmed.match(/^git@([^:]+):([\w-]+)\/([\w.-]+?)(\.git)?$/);
	if (match && match[1] && match[2] && match[3] && /github/i.test(match[1])) {
		return { owner: match[2], repo: match[3] };
	}
	return null;
}

/**
 * Detect GitHub repository information from git remote(s).
 * Tries "origin" first, then any other remote with a GitHub URL.
 */
export function detectGitHubRemote(projectDir: string): GitHubRemote | null {
	if (!isGitRepository(projectDir)) {
		return null;
	}

	try {
		// Try origin first (most common)
		const origin = execSync("git remote get-url origin", {
			cwd: projectDir,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "ignore"],
		}).trim();
		const parsed = parseGitHubRemoteUrl(origin);
		if (parsed) return parsed;
	} catch {
		// No origin or origin not GitHub — try all remotes
	}

	try {
		// git remote -v outputs: remoteName\turl (fetch)\n remoteName\turl (push)
		const out = execSync("git remote -v", {
			cwd: projectDir,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "ignore"],
		});
		for (const line of out.split("\n")) {
			const tab = line.indexOf("\t");
			if (tab === -1) continue;
			const url = line
				.slice(tab + 1)
				.replace(/\s*\((?:fetch|push)\)\s*$/, "")
				.trim();
			const parsed = parseGitHubRemoteUrl(url);
			if (parsed) return parsed;
		}
	} catch {
		// Ignore
	}

	return null;
}

/**
 * Check if user has permission to write to the repository.
 */
export async function checkRepositoryPermissions(token: string, owner: string, repo: string): Promise<boolean> {
	try {
		const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
		});

		if (!response.ok) {
			console.log(chalk.yellow(`  Warning: Failed to check repository permissions (HTTP ${response.status})`));
			return false;
		}

		const data = await response.json();
		return data.permissions?.admin || data.permissions?.push || false;
	} catch (fetchError) {
		console.log(chalk.yellow(`  Warning: Network error checking repository permissions: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`));
		return false;
	}
}
