import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { PerceoDataClient, type ApiKeyScope, getSupabaseUrl, getSupabaseAnonKey } from "@perceo/supabase";
import { loadConfig } from "../config.js";
import { isLoggedIn } from "../auth.js";

export const keysCommand = new Command("keys")
	.description("Manage project API keys for CI/CD authentication");

// ============================================================================
// perceo keys list
// ============================================================================

keysCommand
	.command("list")
	.description("List all API keys for the current project")
	.option("-a, --all", "Include revoked and expired keys", false)
	.action(async (options: { all: boolean }) => {
		const projectDir = process.cwd();

		const loggedIn = await isLoggedIn(projectDir);
		if (!loggedIn) {
			console.error(chalk.red("You must log in first. Run ") + chalk.cyan("perceo login"));
			process.exit(1);
		}

		const spinner = ora("Loading API keys...").start();

		try {
			const config = await loadConfig({ projectDir });
			const projectId = config?.project?.id;

			if (!projectId) {
				spinner.fail("No project ID found. Run perceo init first.");
				process.exit(1);
			}

			const supabaseUrl = getSupabaseUrl();
			const supabaseKey = getSupabaseAnonKey();

			const client = new PerceoDataClient({ supabaseUrl, supabaseKey, projectId });
			const keys = options.all 
				? await client.getApiKeys(projectId)
				: await client.getActiveApiKeys(projectId);

			spinner.stop();

			if (keys.length === 0) {
				console.log(chalk.yellow("No API keys found."));
				console.log(chalk.gray("Create one with: perceo keys create --name <name>"));
				return;
			}

			console.log(chalk.bold("\nAPI Keys:\n"));
			console.log(chalk.gray("─".repeat(80)));

			for (const key of keys) {
				const status = getKeyStatus(key);
				const statusColor = status === "active" ? chalk.green : status === "expired" ? chalk.yellow : chalk.red;

				console.log(`  ${chalk.bold(key.name)}`);
				console.log(`    Prefix: ${chalk.cyan(key.key_prefix)}...`);
				console.log(`    Status: ${statusColor(status)}`);
				console.log(`    Scopes: ${chalk.gray(key.scopes.join(", "))}`);
				console.log(`    Created: ${chalk.gray(formatDate(key.created_at))}`);
				if (key.last_used_at) {
					console.log(`    Last used: ${chalk.gray(formatDate(key.last_used_at))}`);
				}
				if (key.expires_at) {
					console.log(`    Expires: ${chalk.gray(formatDate(key.expires_at))}`);
				}
				console.log(chalk.gray("─".repeat(80)));
			}

			console.log(chalk.gray(`\nTotal: ${keys.length} key(s)`));
		} catch (error) {
			spinner.fail("Failed to load API keys");
			console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
			process.exit(1);
		}
	});

// ============================================================================
// perceo keys create
// ============================================================================

keysCommand
	.command("create")
	.description("Create a new API key")
	.requiredOption("-n, --name <name>", "Name for the API key (e.g., 'github-actions', 'jenkins')")
	.option("-s, --scopes <scopes>", "Comma-separated list of scopes", "ci:analyze,ci:test,flows:read,insights:read,events:publish")
	.option("-e, --expires <days>", "Number of days until expiration (default: never)")
	.action(async (options: { name: string; scopes: string; expires?: string }) => {
		const projectDir = process.cwd();

		const loggedIn = await isLoggedIn(projectDir);
		if (!loggedIn) {
			console.error(chalk.red("You must log in first. Run ") + chalk.cyan("perceo login"));
			process.exit(1);
		}

		const spinner = ora("Creating API key...").start();

		try {
			const config = await loadConfig({ projectDir });
			const projectId = config?.project?.id;

			if (!projectId) {
				spinner.fail("No project ID found. Run perceo init first.");
				process.exit(1);
			}

			const supabaseUrl = getSupabaseUrl();
			const supabaseKey = getSupabaseAnonKey();

			const client = new PerceoDataClient({ supabaseUrl, supabaseKey, projectId });

			const scopes = options.scopes.split(",").map(s => s.trim()) as ApiKeyScope[];
			const expiresAt = options.expires 
				? new Date(Date.now() + parseInt(options.expires, 10) * 24 * 60 * 60 * 1000)
				: undefined;

			const { key, keyRecord } = await client.createApiKey(projectId, {
				name: options.name,
				scopes,
				expiresAt,
			});

			spinner.succeed("API key created successfully!");

			console.log("\n" + chalk.bold.green("New API Key:"));
			console.log(chalk.gray("─".repeat(60)));
			console.log(`  Name:    ${chalk.bold(keyRecord.name)}`);
			console.log(`  Prefix:  ${chalk.cyan(keyRecord.key_prefix)}...`);
			console.log(`  Scopes:  ${chalk.gray(scopes.join(", "))}`);
			if (expiresAt) {
				console.log(`  Expires: ${chalk.gray(formatDate(expiresAt.toISOString()))}`);
			}
			console.log(chalk.gray("─".repeat(60)));
			console.log("\n" + chalk.bold.yellow("  API Key (copy this now - shown only once):"));
			console.log("\n  " + chalk.green(key));
			console.log("\n" + chalk.gray("─".repeat(60)));
			console.log(chalk.gray("\n  Add this as a secret in your CI environment:"));
			console.log(chalk.gray("  - GitHub: Settings → Secrets → PERCEO_API_KEY"));
			console.log(chalk.gray("  - GitLab: Settings → CI/CD → Variables"));
			console.log(chalk.gray("  - Other: Set PERCEO_API_KEY environment variable\n"));
		} catch (error) {
			spinner.fail("Failed to create API key");
			console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
			process.exit(1);
		}
	});

// ============================================================================
// perceo keys revoke
// ============================================================================

keysCommand
	.command("revoke")
	.description("Revoke an API key")
	.argument("<prefix>", "Key prefix to revoke (e.g., prc_abc12345)")
	.option("-r, --reason <reason>", "Reason for revocation")
	.action(async (prefix: string, options: { reason?: string }) => {
		const projectDir = process.cwd();

		const loggedIn = await isLoggedIn(projectDir);
		if (!loggedIn) {
			console.error(chalk.red("You must log in first. Run ") + chalk.cyan("perceo login"));
			process.exit(1);
		}

		const spinner = ora("Revoking API key...").start();

		try {
			const config = await loadConfig({ projectDir });
			const projectId = config?.project?.id;

			if (!projectId) {
				spinner.fail("No project ID found. Run perceo init first.");
				process.exit(1);
			}

			const supabaseUrl = getSupabaseUrl();
			const supabaseKey = getSupabaseAnonKey();

			const client = new PerceoDataClient({ supabaseUrl, supabaseKey, projectId });
			const keys = await client.getApiKeys(projectId);

			// Find key by prefix
			const keyToRevoke = keys.find(k => k.key_prefix === prefix || k.key_prefix.startsWith(prefix));

			if (!keyToRevoke) {
				spinner.fail(`No key found with prefix: ${prefix}`);
				console.log(chalk.gray("Run 'perceo keys list' to see available keys."));
				process.exit(1);
			}

			if (keyToRevoke.revoked_at) {
				spinner.fail(`Key ${keyToRevoke.name} is already revoked.`);
				process.exit(1);
			}

			await client.revokeApiKey(keyToRevoke.id, { reason: options.reason });

			spinner.succeed(`API key "${keyToRevoke.name}" revoked successfully!`);
			console.log(chalk.gray("\nThe key can no longer be used for authentication."));
		} catch (error) {
			spinner.fail("Failed to revoke API key");
			console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
			process.exit(1);
		}
	});

// ============================================================================
// Helpers
// ============================================================================

interface KeyInfo {
	revoked_at: string | null;
	expires_at: string | null;
}

function getKeyStatus(key: KeyInfo): "active" | "revoked" | "expired" {
	if (key.revoked_at) return "revoked";
	if (key.expires_at && new Date(key.expires_at) < new Date()) return "expired";
	return "active";
}

function formatDate(dateStr: string): string {
	const date = new Date(dateStr);
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

