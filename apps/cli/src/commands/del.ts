import { Command } from "commander";
import chalk from "chalk";
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { getEffectiveAuth, clearStoredAuth } from "../auth.js";
import { ensureProjectAccess, checkProjectAccess } from "../projectAccess.js";
import { PerceoDataClient } from "@perceo/supabase";
import { loginCommand } from "./login.js";

const CONFIG_DIR = ".perceo";
const CONFIG_FILE = "config.json";
const GITHUB_WORKFLOW_PATH = ".github/workflows/perceo.yml";

type DelOptions = {
	dir: string;
	yes: boolean;
	"skip-server": boolean;
	"keep-github": boolean;
	"skip-reauth": boolean;
};

type ProjectData = {
	id: string;
	name: string;
	flows: Array<{ id: string; name: string }>;
	personas: Array<{ id: string; name: string }>;
	apiKeys: Array<{ id: string; name: string; key_prefix: string }>;
	testRunsCount: number;
	insightsCount: number;
};

async function fileExists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

/** Read project id/name from .perceo/config.json without full config load. */
async function readProjectFromConfig(projectDir: string): Promise<{ id: string | null; name: string | null }> {
	const configPath = path.join(projectDir, CONFIG_DIR, CONFIG_FILE);
	if (!(await fileExists(configPath))) return { id: null, name: null };
	try {
		const raw = await fs.readFile(configPath, "utf8");
		const config = JSON.parse(raw) as { project?: { id?: string; name?: string } };
		const project = config?.project;
		return {
			id: project?.id ?? null,
			name: project?.name ?? null,
		};
	} catch {
		return { id: null, name: null };
	}
}

/** Fetch comprehensive project data for deletion confirmation */
async function fetchProjectData(client: PerceoDataClient, projectId: string): Promise<ProjectData | null> {
	try {
		const project = await client.getProject(projectId);
		if (!project) return null;

		const [flows, personas, apiKeys, recentTestRuns, insights] = await Promise.all([
			client.getFlows(projectId).catch(() => []),
			client.getPersonas(projectId).catch(() => []),
			client.getApiKeys(projectId).catch(() => []),
			client.getRecentTestRuns(projectId, 1000).catch(() => []),
			client.getInsights(projectId).catch(() => []),
		]);

		return {
			id: project.id,
			name: project.name,
			flows: flows.map((f) => ({ id: f.id, name: f.name })),
			personas: personas.map((p) => ({ id: p.id, name: p.name })),
			apiKeys: apiKeys.map((k) => ({ id: k.id, name: k.name, key_prefix: k.key_prefix })),
			testRunsCount: recentTestRuns.length,
			insightsCount: insights.length,
		};
	} catch (error) {
		console.warn(chalk.yellow(`Warning: Could not fetch complete project data: ${error instanceof Error ? error.message : String(error)}`));
		return null;
	}
}

/** Require user to re-authenticate before destructive operations */
async function requireReauth(projectDir: string): Promise<boolean> {
	console.log(chalk.yellow.bold("\n🔒 Re-authentication Required"));
	console.log(chalk.gray("For security, you must re-authenticate before deleting project data."));
	console.log(chalk.gray("Your current session will be cleared and you'll need to log in again.\n"));

	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise<string>((resolve) => {
		rl.question(chalk.bold("Continue with re-authentication? [y/N]: "), (ans) => {
			rl.close();
			resolve((ans || "n").trim().toLowerCase());
		});
	});

	if (answer !== "y" && answer !== "yes") {
		console.log(chalk.gray("Cancelled."));
		return false;
	}

	// Clear existing auth
	try {
		await clearStoredAuth("project", projectDir);
		await clearStoredAuth("global");
		console.log(chalk.gray("Existing authentication cleared."));
	} catch (error) {
		console.warn(chalk.yellow(`Warning: Could not clear existing auth: ${error instanceof Error ? error.message : String(error)}`));
	}

	// Trigger login flow
	console.log(chalk.cyan("\nPlease log in again:"));
	try {
		// We need to simulate the login command
		const { loginCommand } = await import("./login.js");
		await loginCommand.parseAsync(["login", "--scope", "global"], { from: "user" });
		return true;
	} catch (error) {
		console.error(chalk.red(`Re-authentication failed: ${error instanceof Error ? error.message : String(error)}`));
		return false;
	}
}

export const delCommand = new Command("del")
	.description("Remove Perceo from this project - PERMANENTLY deletes ALL project data including flows, personas, test runs, and API keys")
	.alias("rm")
	.option("-d, --dir <directory>", "Project directory", process.cwd())
	.option("-y, --yes", "Skip confirmation prompt (NOT recommended)", false)
	.option("--skip-server", "Only remove local files; do not delete the project on the server", false)
	.option("--keep-github", "Do not remove .github/workflows/perceo.yml", false)
	.option("--skip-reauth", "Skip re-authentication requirement (DANGEROUS - for development only)", false)
	.action(async (options: DelOptions) => {
		const projectDir = path.resolve(options.dir || process.cwd());
		const perceoDir = path.join(projectDir, CONFIG_DIR);
		const workflowPath = path.join(projectDir, GITHUB_WORKFLOW_PATH);

		const hasPerceoDir = await fileExists(perceoDir);
		const hasWorkflow = await fileExists(workflowPath);
		const { id: projectId, name: projectName } = await readProjectFromConfig(projectDir);
		const willDeleteServer = !options["skip-server"] && projectId;

		if (!hasPerceoDir && !hasWorkflow && !willDeleteServer) {
			console.log(chalk.yellow("No Perceo setup found in this directory. Nothing to remove."));
			return;
		}

		// 1. Require re-authentication for security (unless skipped)
		if (willDeleteServer && !options["skip-reauth"]) {
			const reauthSuccess = await requireReauth(projectDir);
			if (!reauthSuccess) {
				console.log(chalk.red("Re-authentication failed. Deletion cancelled for security."));
				process.exit(1);
			}
		}

		// 2. Ensure we have project access (admin required for server delete) and fetch project data
		let projectData: ProjectData | null = null;
		let deleteClient: PerceoDataClient | null = null;
		let resolvedProjectId: string | null = projectId;
		if (willDeleteServer && (projectId || projectName)) {
			try {
				if (projectId) {
					const access = await ensureProjectAccess({ projectDir, requireAdmin: true });
					deleteClient = access.client;
					resolvedProjectId = access.projectId;
					projectData = await fetchProjectData(deleteClient, access.projectId);
				} else {
					// Config has name but no id: resolve by name and check admin
					const access = await ensureProjectAccess({ projectDir, requireAdmin: false });
					const project = await access.client.getProjectByName(projectName!);
					if (!project) {
						console.error(chalk.red("Project not found or you don't have access."));
						process.exit(1);
					}
					const role = await checkProjectAccess(access.client, project.id, { requireAdmin: true });
					if (!role) {
						console.error(chalk.red("Deleting the project requires owner or admin role."));
						process.exit(1);
					}
					deleteClient = access.client;
					resolvedProjectId = project.id;
					projectData = await fetchProjectData(deleteClient, project.id);
				}
			} catch (err) {
				console.warn(chalk.yellow(`Warning: Could not fetch project data for confirmation: ${err instanceof Error ? err.message : String(err)}`));
			}
		}

		// 3. Show comprehensive confirmation dialog
		if (!options.yes) {
			console.log(chalk.red.bold("\n⚠️  DESTRUCTIVE OPERATION - PERMANENT DATA DELETION"));
			console.log(chalk.red("This will permanently delete ALL Perceo data for this project."));
			console.log(chalk.red("This action CANNOT be undone.\n"));

			console.log(chalk.bold("📁 Local files to be removed:"));
			console.log(chalk.gray("  Directory: ") + chalk.cyan(projectDir));
			if (hasPerceoDir) console.log(chalk.gray("  • ") + chalk.cyan(".perceo/ (config, auth, etc.)"));
			if (hasWorkflow && !options["keep-github"]) console.log(chalk.gray("  • ") + chalk.cyan(GITHUB_WORKFLOW_PATH));

			if (willDeleteServer) {
				console.log(chalk.bold("\n🗄️  Server data to be PERMANENTLY DELETED:"));
				if (projectData) {
					console.log(chalk.gray("  Project: ") + chalk.cyan(`${projectData.name} (${projectData.id})`));
					console.log(chalk.gray("  • ") + chalk.red(`${projectData.flows.length} flows`) + chalk.gray(" (including all steps)"));
					if (projectData.flows.length > 0) {
						projectData.flows.slice(0, 5).forEach((flow) => {
							console.log(chalk.gray("    - ") + chalk.cyan(flow.name));
						});
						if (projectData.flows.length > 5) {
							console.log(chalk.gray(`    ... and ${projectData.flows.length - 5} more`));
						}
					}
					console.log(chalk.gray("  • ") + chalk.red(`${projectData.personas.length} personas`));
					if (projectData.personas.length > 0) {
						projectData.personas.slice(0, 3).forEach((persona) => {
							console.log(chalk.gray("    - ") + chalk.cyan(persona.name));
						});
						if (projectData.personas.length > 3) {
							console.log(chalk.gray(`    ... and ${projectData.personas.length - 3} more`));
						}
					}
					console.log(chalk.gray("  • ") + chalk.red(`${projectData.apiKeys.length} API keys`));
					if (projectData.apiKeys.length > 0) {
						projectData.apiKeys.forEach((key) => {
							console.log(chalk.gray("    - ") + chalk.cyan(`${key.name} (${key.key_prefix}...)`));
						});
					}
					console.log(chalk.gray("  • ") + chalk.red(`${projectData.testRunsCount} test runs`));
					console.log(chalk.gray("  • ") + chalk.red(`${projectData.insightsCount} insights`));
					console.log(chalk.gray("  • ") + chalk.red("All project secrets"));
				} else {
					console.log(chalk.gray("  Project: ") + chalk.cyan(projectId ?? projectName ?? "Unknown"));
					console.log(chalk.gray("  • ") + chalk.red("All flows, personas, and related data"));
					console.log(chalk.gray("  • ") + chalk.red("All API keys and project secrets"));
					console.log(chalk.gray("  • ") + chalk.red("All test runs and insights"));
				}
			}

			console.log(chalk.red.bold("\n💀 This deletion is PERMANENT and IRREVERSIBLE."));
			console.log(chalk.gray("Type the project name to confirm deletion:"));

			const rl = createInterface({ input: process.stdin, output: process.stdout });
			const expectedName = projectData?.name ?? projectName ?? "CONFIRM";
			const answer = await new Promise<string>((resolve) => {
				rl.question(chalk.bold(`Enter "${expectedName}" to confirm: `), (ans) => {
					rl.close();
					resolve((ans || "").trim());
				});
			});

			if (answer !== expectedName) {
				console.log(chalk.gray("Project name does not match. Deletion cancelled."));
				process.exit(0);
			}

			// Final confirmation
			const finalAnswer = await new Promise<string>((resolve) => {
				const rl2 = createInterface({ input: process.stdin, output: process.stdout });
				rl2.question(chalk.red.bold("Are you absolutely sure? This cannot be undone. [type 'DELETE']: "), (ans) => {
					rl2.close();
					resolve((ans || "").trim());
				});
			});

			if (finalAnswer !== "DELETE") {
				console.log(chalk.gray("Final confirmation failed. Deletion cancelled."));
				process.exit(0);
			}
		}

		console.log(chalk.yellow("\n🗑️  Starting deletion process..."));

		const deletionSummary = {
			localFiles: [] as string[],
			serverData: {
				project: null as { id: string; name: string } | null,
				flows: 0,
				personas: 0,
				apiKeys: 0,
				testRuns: 0,
				insights: 0,
				secrets: 0,
			},
		};

		// 4. Delete server-side project and all related data (using client from access check)
		if (willDeleteServer && deleteClient && resolvedProjectId) {
			try {
				// Get final counts before deletion
				if (projectData) {
					deletionSummary.serverData = {
						project: { id: projectData.id, name: projectData.name },
						flows: projectData.flows.length,
						personas: projectData.personas.length,
						apiKeys: projectData.apiKeys.length,
						testRuns: projectData.testRunsCount,
						insights: projectData.insightsCount,
						secrets: 0, // We can't easily count secrets, but they'll be deleted by cascade
					};
				}

				// Delete project (cascades to all related data due to foreign key constraints)
				await deleteClient.deleteProject(resolvedProjectId);
				console.log(chalk.green("✅ Deleted project and all related data on server"));
			} catch (err) {
				console.error(chalk.red("❌ Failed to delete project on server: " + (err instanceof Error ? err.message : String(err))));
				process.exit(1);
			}
		}

		// 5. Remove GitHub workflow
		if (hasWorkflow && !options["keep-github"]) {
			await fs.rm(workflowPath, { force: true });
			deletionSummary.localFiles.push(GITHUB_WORKFLOW_PATH);
			console.log(chalk.green("✅ Removed ") + chalk.cyan(GITHUB_WORKFLOW_PATH));
		}

		// 6. Remove .perceo directory (config, auth, readme, etc.)
		if (hasPerceoDir) {
			await fs.rm(perceoDir, { recursive: true, force: true });
			deletionSummary.localFiles.push(".perceo/");
			console.log(chalk.green("✅ Removed ") + chalk.cyan(".perceo/"));
		}

		// 7. Show deletion summary
		console.log(chalk.bold.green("\n🎉 Perceo successfully removed from this project"));
		console.log(chalk.bold("📊 Deletion Summary:"));

		if (deletionSummary.localFiles.length > 0) {
			console.log(chalk.gray("  Local files removed:"));
			deletionSummary.localFiles.forEach((file) => {
				console.log(chalk.gray("    • ") + chalk.cyan(file));
			});
		}

		if (deletionSummary.serverData.project) {
			console.log(chalk.gray("  Server data deleted:"));
			console.log(chalk.gray("    • Project: ") + chalk.cyan(deletionSummary.serverData.project.name));
			console.log(chalk.gray("    • Flows: ") + chalk.red(deletionSummary.serverData.flows.toString()));
			console.log(chalk.gray("    • Personas: ") + chalk.red(deletionSummary.serverData.personas.toString()));
			console.log(chalk.gray("    • API Keys: ") + chalk.red(deletionSummary.serverData.apiKeys.toString()));
			console.log(chalk.gray("    • Test Runs: ") + chalk.red(deletionSummary.serverData.testRuns.toString()));
			console.log(chalk.gray("    • Insights: ") + chalk.red(deletionSummary.serverData.insights.toString()));
			console.log(chalk.gray("    • Project secrets and all related data"));
		}

		console.log(chalk.gray("\nTo set up Perceo again, run: ") + chalk.cyan("perceo init"));
	});
