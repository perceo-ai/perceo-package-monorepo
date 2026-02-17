import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { isLoggedIn, getEffectiveAuth } from "../auth.js";
import { checkProjectAccess } from "../projectAccess.js";
import { PerceoDataClient, type ApiKeyScope, getSupabaseUrl, getSupabaseAnonKey, type Flow, type Persona } from "@perceo/supabase";
import { detectGitHubRemote, isGitRepository, authorizeGitHub, createRepositorySecret, checkRepositoryPermissions } from "../github.js";
import { createInterface } from "node:readline";
import os from "node:os";

type InitOptions = {
	dir: string;
	skipGithub: boolean;
	yes: boolean;
	branch?: string;
	configurePersonas: boolean;
};

type PackageJson = {
	name?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};

const CONFIG_DIR = ".perceo";
const CONFIG_FILE = "config.json";

/** Frameworks we support for now (React/website). More will be added later. */
const SUPPORTED_FRAMEWORKS = ["nextjs", "react", "remix"];

/** Format Supabase/Postgrest or Error for display (avoids "[object Object]"). */
function formatDbError(err: unknown): string {
	if (err instanceof Error) return err.message;
	const o = err as { message?: string; code?: string; details?: string };
	if (o && typeof o.message === "string") {
		const parts = [o.message];
		if (typeof o.code === "string") parts.push(`(code: ${o.code})`);
		if (typeof o.details === "string") parts.push(o.details);
		return parts.join(" ");
	}
	return String(err);
}

export const initCommand = new Command("init")
	.description("Initialize Perceo in your project and discover flows")
	.option("-d, --dir <directory>", "Project directory", process.cwd())
	.option("--skip-github", "Skip GitHub Actions setup", false)
	.option("-y, --yes", "Skip confirmation prompt (e.g. for CI)", false)
	.option("-b, --branch <branch>", "Main branch name (default: auto-detect)")
	.option("--configure-personas", "Configure custom user personas instead of auto-generating them", false)
	.action(async (options: InitOptions) => {
		const projectDir = path.resolve(options.dir || process.cwd());

		const loggedIn = await isLoggedIn(projectDir);
		if (!loggedIn) {
			console.error(chalk.red("You must log in first. Run ") + chalk.cyan("perceo login") + chalk.red(", then run ") + chalk.cyan("perceo init") + chalk.red(" again."));
			process.exit(1);
		}

		// Confirm directory so users don't accidentally init in home or wrong repo
		if (!options.yes) {
			const isGit = isGitRepository(projectDir);
			const remote = detectGitHubRemote(projectDir);
			const isHomeDir = projectDir === os.homedir();
			console.log(chalk.bold("Initialize Perceo in this directory?"));
			console.log(chalk.gray("  Directory:   ") + chalk.cyan(projectDir));
			if (remote) {
				console.log(chalk.gray("  Repository:  ") + chalk.cyan(`${remote.owner}/${remote.repo}`));
			} else if (isGit) {
				console.log(chalk.gray("  Repository:  ") + chalk.yellow("Git repository (no GitHub remote)"));
			} else {
				console.log(chalk.gray("  Repository:  ") + chalk.yellow("Not a git repository"));
			}
			if (isHomeDir) {
				console.log(chalk.yellow("  Warning: This is your home directory. Prefer running from a project directory."));
			}
			const rl = createInterface({ input: process.stdin, output: process.stdout });
			const answer = await new Promise<string>((resolve) => {
				rl.question(chalk.bold("Continue? [y/N]: "), (ans) => {
					rl.close();
					resolve((ans || "n").trim().toLowerCase());
				});
			});
			if (answer !== "y" && answer !== "yes") {
				console.log(chalk.gray("Init cancelled."));
				process.exit(0);
			}
		}

		const spinner = ora(`Initializing Perceo in ${chalk.cyan(projectDir)}...`).start();

		try {
			const pkg = await readPackageJson(projectDir);
			const projectName = pkg?.name || path.basename(projectDir);
			const framework = await detectFramework(projectDir, pkg);

			// Detect or use specified branch
			let branch = options.branch;
			if (!branch) {
				branch = detectDefaultBranch(projectDir);
				console.log(chalk.gray(`  Auto-detected default branch: ${branch}`));
			} else {
				console.log(chalk.gray(`  Using specified branch: ${branch}`));
			}

			if (!SUPPORTED_FRAMEWORKS.includes(framework)) {
				spinner.fail("Unsupported project type");
				const detected = framework === "unknown" ? "No React/Next.js/Remix project detected" : `Detected: ${framework}`;
				console.error(chalk.red(detected + "."));
				console.error(chalk.yellow("Perceo currently supports React, Next.js, and Remix projects. Support for more frameworks is coming soon."));
				process.exit(1);
			}

			const perceoDir = path.join(projectDir, CONFIG_DIR);
			const perceoConfigPath = path.join(perceoDir, CONFIG_FILE);

			// Ensure .perceo directory exists
			await fs.mkdir(perceoDir, { recursive: true });

			// ============================================================================
			// Observer bootstrap via Temporal Worker HTTP API
			// ============================================================================

			spinner.text = "Bootstrapping project via Perceo Observer...";

			// Get authentication token first
			const storedAuth = await getEffectiveAuth(projectDir);
			if (!storedAuth) {
				spinner.fail("Authentication required");
				throw new Error("Please run 'perceo login' first");
			}

			// Use the URL from stored auth to ensure JWT is valid
			const supabaseUrl = storedAuth.supabaseUrl;
			const supabaseKey = getSupabaseAnonKey();

			// Create temp client with user session to get/create project
			let tempClient: PerceoDataClient;
			try {
				console.log(chalk.gray(`\n  Connecting to Perceo Cloud: ${supabaseUrl}`));
				tempClient = await PerceoDataClient.fromUserSession({
					supabaseUrl: storedAuth.supabaseUrl,
					supabaseKey,
					accessToken: storedAuth.access_token,
					refreshToken: storedAuth.refresh_token,
				});
			} catch (authError) {
				spinner.fail("Failed to connect to Perceo Cloud");
				console.error(chalk.red("\nAuthentication error details:"));
				console.error(chalk.gray(`  Supabase URL: ${supabaseUrl}`));
				console.error(chalk.gray(`  Error: ${authError instanceof Error ? authError.message : String(authError)}`));
				if (authError instanceof Error && authError.stack) {
					console.error(chalk.gray(`  Stack: ${authError.stack}`));
				}
				throw new Error(`Failed to authenticate with Perceo Cloud. Try running 'perceo logout' followed by 'perceo login'.`);
			}

			// Create project first if it doesn't exist (need project ID for workflow)
			let tempProject: any;

			// Detect git remote URL early (needed for both project creation and workflow)
			const remote = detectGitHubRemote(projectDir);
			const gitRemoteUrl = remote ? `https://github.com/${remote.owner}/${remote.repo}` : null;

			try {
				spinner.text = "Looking up project...";
				tempProject = await tempClient.getProjectByName(projectName);
			} catch (dbError) {
				spinner.fail("Failed to query project");
				console.error(chalk.red("\nDatabase error details:"));
				console.error(chalk.gray(`  ${formatDbError(dbError)}`));
				throw new Error("Failed to query project from database");
			}

			if (!tempProject) {
				try {
					spinner.text = "Creating project...";

					tempProject = await tempClient.createProject({
						name: projectName,
						framework,
						config: { source: "cli-init" },
						git_remote_url: gitRemoteUrl,
					});
				} catch (createError) {
					spinner.fail("Failed to create project");
					console.error(chalk.red("\nDatabase error details:"));
					console.error(chalk.gray(`  ${formatDbError(createError)}`));
					throw new Error("Failed to create project in database");
				}
			} else {
				// Existing project: ensure current user has access
				const role = await checkProjectAccess(tempClient, tempProject.id);
				if (!role) {
					spinner.fail("Access denied");
					console.error(chalk.red(`\nYou don't have access to the project "${tempProject.name}".`));
					console.error(chalk.gray("Only users added to the project can run init. Ask a project owner or admin to add you."));
					process.exit(1);
				}
			}

			// ============================================================================
			// Generate Workflow API Key (for Temporal workflow authorization)
			// ============================================================================
			spinner.text = "Generating workflow authorization key...";
			let workflowApiKey: string;

			try {
				// Get current user ID for audit trail
				const {
					data: { user },
				} = await tempClient.getSupabaseClient().auth.getUser();
				const userId = user?.id;

				// Check if a workflow auth key already exists and revoke it (allow re-init)
				try {
					const existingKeys = await tempClient.getApiKeys(tempProject.id);
					const existingWorkflowKey = existingKeys.find((k) => k.name === "temporal-workflow-auth");
					if (existingWorkflowKey) {
						console.log(chalk.gray("\n  ✓ Found existing workflow key, deleting it"));
						await tempClient.deleteApiKey(existingWorkflowKey.id);
					}
				} catch (cleanupError) {
					// Non-fatal: if we can't check/clean up existing keys, we'll try to create anyway
					console.log(chalk.gray(`  Note: Could not check for existing keys: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`));
				}

				const { key } = await tempClient.createApiKey(tempProject.id, {
					name: "temporal-workflow-auth",
					scopes: ["workflows:start"],
					createdBy: userId,
				});
				workflowApiKey = key;
				console.log(chalk.gray("\n  ✓ Workflow authorization key generated"));
				console.log(chalk.gray(`    Key prefix: ${key.substring(0, 12)}...`));
			} catch (keyError) {
				// CRITICAL: This should not happen in production. The workflow requires DB-stored keys.
				spinner.fail("Database key generation failed");
				console.error(chalk.red("\n  ✗ CRITICAL: Cannot generate workflow authorization key in database"));

				// Handle Supabase PostgrestError objects properly
				if (keyError && typeof keyError === "object") {
					const err = keyError as any;
					console.error(chalk.gray(`    Error code: ${err.code || "N/A"}`));
					console.error(chalk.gray(`    Error message: ${err.message || "Unknown error"}`));
					if (err.details) {
						console.error(chalk.gray(`    Details: ${err.details}`));
					}
					if (err.hint) {
						console.error(chalk.gray(`    Hint: ${err.hint}`));
					}
				} else if (keyError instanceof Error) {
					console.error(chalk.gray(`    Error: ${keyError.message}`));
					if (keyError.stack) {
						console.error(chalk.gray(`    Stack: ${keyError.stack}`));
					}
				} else {
					console.error(chalk.gray(`    Error: ${String(keyError)}`));
				}

				// Generate a secure local key (same format as database keys)
				const crypto = await import("node:crypto");
				const keyBytes = crypto.randomBytes(32);
				workflowApiKey = `prc_${keyBytes.toString("base64url")}`;

				console.log(chalk.yellow("\n  ⚠ Using temporary local key as fallback"));
				console.log(chalk.gray(`    Key prefix: ${workflowApiKey.substring(0, 12)}...`));
				console.log(chalk.red("  ✗ WARNING: Temporal workflows will NOT work with this key"));
				console.log(chalk.red("  ✗ You must fix the database issue before workflows can run"));

				throw new Error("Failed to generate workflow authorization key in database");
			}

			// Prepare Worker API connection details
			const workerApiUrl = process.env.PERCEO_WORKER_API_URL || "https://perceo-temporal-worker-331577200018.us-west1.run.app/";
			const workerApiKey = process.env.PERCEO_WORKER_API_KEY;

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			if (workerApiKey) {
				headers["x-api-key"] = workerApiKey;
			}

			// ============================================================================
			// Configure LLM API Key (required for bootstrap)
			// ============================================================================
			spinner.stop();

			// Note: LLM API key must be configured in Supabase project_secrets table
			// by the Perceo admin. The temporal workflow will pull it from there.
			console.log(chalk.gray("\n  ℹ️  LLM API key will be fetched from secure storage during bootstrap"));
			console.log(chalk.gray("     (configured by admin in Supabase project_secrets table)"));

			// ============================================================================
			// Configure User Personas (if requested)
			// ============================================================================
			let userConfiguredPersonas: any[] = [];
			let useCustomPersonas = false;

			if (options.configurePersonas) {
				spinner.stop();
				console.log(chalk.bold("\n🎭 Configure User Personas"));
				console.log(chalk.gray("Define custom user personas for your application, or let Perceo auto-generate them from your codebase."));

				const rl = createInterface({ input: process.stdin, output: process.stdout });

				const configurePersonasAnswer = await new Promise<string>((resolve) => {
					rl.question(chalk.cyan("Do you want to configure custom personas? [y/N]: "), (ans) => {
						resolve((ans || "n").trim().toLowerCase());
					});
				});

				if (configurePersonasAnswer === "y" || configurePersonasAnswer === "yes") {
					useCustomPersonas = true;
					console.log(chalk.green("\n✓ Configuring custom personas"));
					console.log(chalk.gray("Enter persona details (press Enter with empty name to finish):"));

					let personaIndex = 1;
					while (true) {
						console.log(chalk.bold(`\nPersona ${personaIndex}:`));

						const name = await new Promise<string>((resolve) => {
							rl.question(chalk.cyan("  Name: "), resolve);
						});

						if (!name.trim()) {
							break;
						}

						const description = await new Promise<string>((resolve) => {
							rl.question(chalk.cyan("  Description: "), resolve);
						});

						const behaviors = await new Promise<string>((resolve) => {
							rl.question(chalk.cyan("  Key behaviors (comma-separated): "), resolve);
						});

						// Parse behaviors into a structured format
						const behaviorList = behaviors
							.split(",")
							.map((b) => b.trim())
							.filter((b) => b.length > 0);
						const behaviorObj: Record<string, any> = {};

						behaviorList.forEach((behavior, idx) => {
							behaviorObj[`behavior_${idx + 1}`] = behavior;
						});

						userConfiguredPersonas.push({
							name: name.trim(),
							description: description.trim() || null,
							behaviors: behaviorObj,
						});

						console.log(chalk.green(`  ✓ Added persona: ${name}`));
						personaIndex++;
					}

					if (userConfiguredPersonas.length === 0) {
						console.log(chalk.yellow("  No personas configured, will use auto-generation"));
						useCustomPersonas = false;
					} else {
						console.log(chalk.green(`\n✓ Configured ${userConfiguredPersonas.length} custom personas`));

						// Store personas in database before starting workflow
						try {
							console.log(chalk.gray("  Saving personas to database..."));
							await tempClient.createUserConfiguredPersonas(userConfiguredPersonas, tempProject.id);
							console.log(chalk.green("  ✓ Personas saved successfully"));
						} catch (personaError) {
							console.error(chalk.red("  ✗ Failed to save personas:"), personaError);
							throw new Error("Failed to save custom personas to database");
						}
					}
				}

				rl.close();
				spinner.start("Starting bootstrap workflow...");
			} else {
				spinner.start("Starting bootstrap workflow...");
			}

			let bootstrapResponse: Response;
			try {
				console.log(chalk.gray(`\n  Connecting to worker API: ${workerApiUrl}`));
				console.log(chalk.gray(`  Project ID: ${tempProject.id}`));
				console.log(chalk.gray(`  Git Remote URL: ${gitRemoteUrl || "Not detected"}`));
				console.log(chalk.gray(`  Workflow API Key: ${workflowApiKey.substring(0, 12)}...`));

				if (!gitRemoteUrl) {
					spinner.fail("Cannot start bootstrap workflow");
					throw new Error("Git remote URL not detected. Please ensure this is a Git repository with a GitHub remote configured.");
				}

				bootstrapResponse = await fetch(`${workerApiUrl}/api/workflows/bootstrap`, {
					method: "POST",
					headers,
					body: JSON.stringify({
						projectId: tempProject.id,
						gitRemoteUrl,
						projectName,
						framework,
						branch,
						workflowApiKey,
						useCustomPersonas,
					}),
				});
			} catch (fetchError) {
				spinner.fail("Failed to connect to worker API");
				console.error(chalk.red("\nNetwork error details:"));
				console.error(chalk.gray(`  URL: ${workerApiUrl}/api/workflows/bootstrap`));
				console.error(chalk.gray(`  Error: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`));
				if (fetchError instanceof Error && fetchError.cause) {
					console.error(chalk.gray(`  Cause: ${JSON.stringify(fetchError.cause, null, 2)}`));
				}
				throw new Error(`Failed to connect to worker API at ${workerApiUrl}. Check that PERCEO_WORKER_API_URL is correct and the service is running.`);
			}

			if (!bootstrapResponse.ok) {
				const errorData = await bootstrapResponse.json().catch(() => ({}));
				spinner.fail("Failed to start bootstrap workflow");
				console.error(chalk.red(`  HTTP ${bootstrapResponse.status}: ${bootstrapResponse.statusText}`));
				throw new Error(`Bootstrap start failed: ${errorData.error || bootstrapResponse.statusText}`);
			}

			const { workflowId } = (await bootstrapResponse.json()) as { workflowId: string; message: string };

			console.log(chalk.gray(`\n  Workflow ID: ${workflowId}`));
			spinner.text = "Initializing workflow...";

			// Poll workflow progress
			let temporalResult: BootstrapProjectResult;
			for (;;) {
				let queryResponse: Response;
				try {
					queryResponse = await fetch(`${workerApiUrl}/api/workflows/${workflowId}`, {
						headers,
					});
				} catch (fetchError) {
					console.log(chalk.yellow("\n  Warning: Failed to query workflow progress (network error), retrying..."));
					console.log(chalk.gray(`    Error: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`));
					await sleep(2000);
					continue;
				}

				if (!queryResponse.ok) {
					console.log(chalk.yellow(`\n  Warning: Failed to query workflow progress (HTTP ${queryResponse.status}), retrying...`));
					await sleep(2000);
					continue;
				}

				const queryResult = (await queryResponse.json()) as {
					workflowId: string;
					progress?: BootstrapProgress;
					completed: boolean;
					result?: BootstrapProjectResult;
					error?: string;
				};

				if (queryResult.progress?.message) {
					spinner.prefixText = chalk.gray(`[${queryResult.progress.stage}]`);
					spinner.text = `${queryResult.progress.message} (${queryResult.progress.percentage}%)`;
				}

				if (queryResult.completed) {
					if (queryResult.error) {
						spinner.fail("Bootstrap workflow failed");
						throw new Error(queryResult.error);
					}
					if (!queryResult.result) {
						spinner.fail("Bootstrap workflow completed but no result returned");
						throw new Error("No result from workflow");
					}
					// Success - break with result
					temporalResult = queryResult.result;
					break;
				}

				if (queryResult.progress?.stage === "error") {
					spinner.fail("Bootstrap workflow failed");
					throw new Error(queryResult.progress.error || "Unknown workflow error");
				}

				await sleep(1000);
			}

			spinner.succeed("Bootstrap complete!");
			console.log(chalk.green("\n✓ Bootstrap successful:"));
			console.log(chalk.gray(`  Personas: ${temporalResult.personasExtracted}`));
			console.log(chalk.gray(`  Flows: ${temporalResult.flowsExtracted}`));
			console.log(chalk.gray(`  Steps: ${temporalResult.stepsExtracted}`));
			console.log(chalk.gray(`  Commits: ${temporalResult.totalCommitsProcessed}`));
			console.log();

			spinner.start("Finishing initialization...");

			// Use embedded Perceo Cloud credentials and, if available, the user's auth session
			spinner.text = "Connecting to Perceo Cloud...";
			let client: PerceoDataClient;

			if (storedAuth) {
				try {
					client = await (PerceoDataClient as any).fromUserSession({
						supabaseUrl: storedAuth.supabaseUrl,
						supabaseKey,
						accessToken: storedAuth.access_token,
						refreshToken: storedAuth.refresh_token,
					});
				} catch (authError) {
					spinner.warn("Failed to attach user session, falling back to anonymous access");
					console.log(chalk.gray(`  ${authError instanceof Error ? authError.message : typeof authError === "string" ? authError : "Unknown error while restoring session"}`));
					spinner.start("Connecting to Perceo Cloud...");
					client = new PerceoDataClient({ supabaseUrl, supabaseKey });
				}
			} else {
				client = new PerceoDataClient({ supabaseUrl, supabaseKey });
			}

			// Git remote URL was already detected earlier (reuse the same variables)

			// Get or create project (project was already created/retrieved for temporal workflow, but ensure it exists)
			let project: any;
			try {
				spinner.text = "Syncing project...";
				project = await client.getProjectByName(projectName);
			} catch (dbError) {
				spinner.fail("Failed to query project");
				console.error(chalk.red("\nDatabase error details:"));
				console.error(chalk.gray(`  ${formatDbError(dbError)}`));
				throw new Error("Failed to query project from database");
			}

			if (!project) {
				try {
					spinner.text = "Creating project...";
					project = await client.createProject({
						name: projectName,
						framework,
						config: { source: "cli-init" },
						git_remote_url: gitRemoteUrl,
					});
				} catch (createError) {
					spinner.fail("Failed to create project");
					console.error(chalk.red("\nDatabase error details:"));
					console.error(chalk.gray(`  ${formatDbError(createError)}`));
					throw new Error("Failed to create project in database");
				}
			} else if (gitRemoteUrl && project.git_remote_url !== gitRemoteUrl) {
				// Update git remote if it changed
				try {
					await client.updateProject(project.id, { git_remote_url: gitRemoteUrl });
				} catch (updateError) {
					// Don't fail on git remote update error, just warn
					console.log(chalk.yellow(`  Warning: Failed to update git remote URL: ${updateError instanceof Error ? updateError.message : String(updateError)}`));
				}
			}
			const projectId = project.id;

			// Use results from temporal workflow - flows are already extracted and persisted by the workflow
			const flowsDiscovered = temporalResult.flowsExtracted;
			const flowsNew = temporalResult.flowsExtracted; // All flows from temporal are new (workflow handles deduplication)

			// Generate API key and GitHub Actions workflow
			let apiKey: string | null = null;
			let workflowCreated = false;
			let githubAutoConfigured = false;

			if (projectId && !options.skipGithub) {
				spinner.text = "Generating CI API key...";

				const scopes: ApiKeyScope[] = ["ci:analyze", "ci:test", "flows:read", "insights:read", "events:publish"];

				try {
					// Get current user ID for audit trail
					const {
						data: { user },
					} = await client.getSupabaseClient().auth.getUser();
					const userId = user?.id;

					// Check if a github-actions key already exists and revoke it (allow re-init)
					try {
						const existingKeys = await client.getApiKeys(projectId);
						const existingGhKey = existingKeys.find((k) => k.name === "github-actions");
						if (existingGhKey) {
							console.log(chalk.gray("\n  ✓ Found existing GitHub Actions key, deleting it"));
							await client.deleteApiKey(existingGhKey.id);
						}
					} catch (cleanupError) {
						// Non-fatal: if we can't check/clean up existing keys, we'll try to create anyway
						console.log(chalk.gray(`  Note: Could not check for existing keys: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`));
					}

					const { key } = await client.createApiKey(projectId, {
						name: "github-actions",
						scopes,
						createdBy: userId,
					});
					apiKey = key;

					// Detect GitHub remote
					const remote = detectGitHubRemote(projectDir);

					if (remote) {
						spinner.stop();
						console.log(chalk.cyan(`\n📦 Detected GitHub repository: ${remote.owner}/${remote.repo}`));

						const rl = createInterface({ input: process.stdin, output: process.stdout });
						const answer = await new Promise<string>((resolve) => {
							rl.question(chalk.bold("Auto-configure GitHub Actions? (Y/n): "), (ans) => {
								rl.close();
								resolve((ans || "y").toLowerCase());
							});
						});

						if (answer === "y" || answer === "yes" || answer === "") {
							try {
								spinner.start("Authorizing with GitHub...");
								const ghAuth = await authorizeGitHub();

								spinner.text = "Checking repository permissions...";
								const hasPermission = await checkRepositoryPermissions(ghAuth.accessToken, remote.owner, remote.repo);

								if (!hasPermission) {
									spinner.warn("Insufficient permissions to write to repository");
									console.log(chalk.yellow("  You need admin or push access to configure secrets automatically."));
								} else {
									spinner.text = "Creating PERCEO_API_KEY secret...";
									if (!apiKey) {
										throw new Error("API key not found after creation");
									}
									await createRepositorySecret(ghAuth.accessToken, remote.owner, remote.repo, "PERCEO_API_KEY", apiKey!);

									githubAutoConfigured = true;
									spinner.text = "Creating GitHub Actions workflow...";
								}
							} catch (error) {
								spinner.warn("GitHub authorization failed");
								console.log(chalk.yellow(`  ${error instanceof Error ? error.message : "Unknown error"}`));
								console.log(chalk.gray("  Continuing with manual setup instructions..."));
							}
						}

						if (!githubAutoConfigured) {
							spinner.start("Creating GitHub Actions workflow...");
						}
					} else {
						spinner.text = "Creating GitHub Actions workflow...";
					}

					// Create GitHub Actions workflow file
					const workflowDir = path.join(projectDir, ".github", "workflows");
					const workflowPath = path.join(workflowDir, "perceo.yml");

					await fs.mkdir(workflowDir, { recursive: true });

					if (!(await fileExists(workflowPath))) {
						const workflowContent = generateGitHubWorkflow(branch);
						await fs.writeFile(workflowPath, workflowContent, "utf8");
						workflowCreated = true;
					}
				} catch (error) {
					// Fallback: generate a local API key if database insert fails
					// This ensures init never fails and users still get a usable key
					console.log(chalk.yellow("\n  ⚠ Database key generation failed, using local fallback"));

					// Handle Supabase PostgrestError objects properly
					if (error && typeof error === "object") {
						const err = error as any;
						console.error(chalk.gray(`    Error code: ${err.code || "N/A"}`));
						console.error(chalk.gray(`    Error message: ${err.message || "Unknown error"}`));
						if (err.details) {
							console.error(chalk.gray(`    Details: ${err.details}`));
						}
						if (err.hint) {
							console.error(chalk.gray(`    Hint: ${err.hint}`));
						}
					} else if (error instanceof Error) {
						console.error(chalk.gray(`    Error: ${error.message}`));
					} else {
						console.error(chalk.gray(`    Error: ${String(error)}`));
					}

					// Generate a secure local key (same format as database keys)
					const crypto = await import("node:crypto");
					const keyBytes = crypto.randomBytes(32);
					apiKey = `prc_${keyBytes.toString("base64url")}`;

					console.log(chalk.gray("  ✓ Local CI API key generated"));
					console.log(chalk.gray(`    Key prefix: ${apiKey.substring(0, 12)}...`));
					console.log(chalk.yellow("  ⚠ This key is not stored in the database and is local-only"));

					// Still try to create workflow file if we have a local key
					try {
						const workflowDir = path.join(projectDir, ".github", "workflows");
						const workflowPath = path.join(workflowDir, "perceo.yml");
						await fs.mkdir(workflowDir, { recursive: true });
						if (!(await fileExists(workflowPath))) {
							const workflowContent = generateGitHubWorkflow(branch);
							await fs.writeFile(workflowPath, workflowContent, "utf8");
							workflowCreated = true;
						}
					} catch (workflowError) {
						console.log(chalk.yellow("  ⚠ Could not create workflow file"));
						console.log(chalk.gray(`    ${workflowError instanceof Error ? workflowError.message : "Unknown error"}`));
					}
				}
			}

			// If config already exists, do not overwrite – just inform the user
			if (await fileExists(perceoConfigPath)) {
				spinner.stop();
				console.log(chalk.yellow(`\n.perceo/${CONFIG_FILE} already exists. Skipping config generation.`));
			} else {
				const config = createDefaultConfig(projectName, framework, projectId, branch);
				await fs.writeFile(perceoConfigPath, JSON.stringify(config, null, 2) + "\n", "utf8");
			}

			// Create a minimal README
			const readmePath = path.join(perceoDir, "README.md");
			if (!(await fileExists(readmePath))) {
				await fs.writeFile(readmePath, createPerceoReadme(projectName), "utf8");
			}

			spinner.succeed("Perceo initialized successfully!");

			console.log("\n" + chalk.bold("Project: ") + projectName);
			console.log(chalk.bold("Framework: ") + framework);
			console.log(chalk.bold("Branch: ") + branch);
			console.log(chalk.bold("Config: ") + path.relative(projectDir, perceoConfigPath));
			console.log(chalk.bold("Project ID: ") + projectId);
			console.log(chalk.bold("Flows discovered: ") + `${flowsDiscovered} (${flowsNew} new)`);

			// Show ASCII graph of personas → flows → pages (from bootstrap)
			await renderBootstrapGraph(client, projectId);

			// GitHub Actions setup output
			if (githubAutoConfigured && workflowCreated) {
				console.log("\n" + chalk.bold.green("✓ GitHub Actions configured automatically!"));
				console.log(chalk.gray("─".repeat(50)));
				console.log("\n  Workflow: " + chalk.cyan(".github/workflows/perceo.yml"));
				console.log("  Secret: " + chalk.green("PERCEO_API_KEY") + " " + chalk.gray("(already added)"));
				console.log("\n" + chalk.gray("  CI will run on pull requests automatically."));
				console.log(chalk.gray("─".repeat(50)));
			} else if (apiKey && workflowCreated) {
				console.log("\n" + chalk.bold.yellow("GitHub Actions Setup (Manual):"));
				console.log(chalk.gray("─".repeat(50)));
				console.log("\n  Workflow created at: " + chalk.cyan(".github/workflows/perceo.yml"));
				console.log("\n  " + chalk.bold("Add this secret to your repository:"));
				console.log("  " + chalk.gray("Settings → Secrets and variables → Actions → New repository secret"));
				console.log("\n  Name:  " + chalk.yellow("PERCEO_API_KEY"));
				console.log("  Value: " + chalk.green(apiKey));
				console.log("\n" + chalk.gray("  ⚠️  This key is shown only once. Store it securely."));
				console.log(chalk.gray("  ⚠️  Manage keys with: perceo keys list"));
				console.log(chalk.gray("─".repeat(50)));
			} else if (apiKey && !workflowCreated) {
				console.log("\n" + chalk.bold.green("CI API Key Generated:"));
				console.log(chalk.gray("─".repeat(50)));
				console.log("\n  " + chalk.bold("Add this secret to your CI:"));
				console.log("\n  Name:  " + chalk.yellow("PERCEO_API_KEY"));
				console.log("  Value: " + chalk.green(apiKey));
				console.log("\n  Workflow already exists at .github/workflows/perceo.yml");
				console.log(chalk.gray("─".repeat(50)));
			} else if (!options.skipGithub && projectId) {
				console.log("\n" + chalk.yellow("⚠️  GitHub Actions setup skipped."));
			}

			console.log("\n" + chalk.bold("Next steps:"));
			if (githubAutoConfigured) {
				console.log("  1. Review flows: " + chalk.cyan("perceo flows list"));
				console.log("  2. Commit and push: " + chalk.cyan("git add . && git commit -m 'Add Perceo' && git push"));
				console.log("  3. Open a PR to see Perceo analyze your changes!");
			} else if (apiKey) {
				console.log("  1. " + chalk.bold("Add the PERCEO_API_KEY secret to GitHub") + " (see above)");
				console.log("  2. Review flows: " + chalk.cyan("perceo flows list"));
				console.log("  3. Commit and push to trigger CI: " + chalk.cyan("git add . && git commit -m 'Add Perceo'"));
			} else {
				console.log("  1. Review flows: " + chalk.cyan("perceo flows list"));
				console.log("  2. Analyze PR changes: " + chalk.cyan(`perceo analyze --base ${branch}`));
			}
			console.log("\n" + chalk.gray("Run `perceo logout` to sign out if needed."));
		} catch (error) {
			spinner.fail("Failed to initialize Perceo");

			if (error instanceof Error) {
				console.error(chalk.red(error.message));

				// In debug/development mode, also print the stack trace for easier diagnosis
				if (process.env.PERCEO_DEBUG === "1" || process.env.NODE_ENV === "development") {
					if (error.stack) {
						console.error(chalk.gray(error.stack));
					}
				}
			} else {
				// Ensure we never emit a useless "Unknown error" – always show the raw value
				try {
					console.error(chalk.red(`Unexpected error: ${JSON.stringify(error, null, 2)}`));
				} catch {
					console.error(chalk.red(`Unexpected error: ${String(error)}`));
				}
			}

			process.exit(1);
		}
	});

// ============================================================================
// Observer bootstrap workflow types (kept in sync with apps/temporal-worker/src/workflows/bootstrap-project.workflow.ts)
interface BootstrapProjectInput {
	projectId: string;
	gitRemoteUrl: string; // Git remote URL to clone
	projectName: string;
	framework: string;
	branch: string;
	workflowApiKey: string; // Project-scoped API key for workflow authorization
	supabaseUrl: string;
	supabaseServiceRoleKey: string;
	useCustomPersonas?: boolean; // Whether to use user-configured personas instead of auto-generating
}

interface BootstrapProjectResult {
	projectId: string;
	personasExtracted: number;
	flowsExtracted: number;
	stepsExtracted: number;
	totalCommitsProcessed: number;
}

interface BootstrapProgress {
	stage: "init" | "validating" | "git-scan" | "extract-personas" | "extract-flows" | "extract-steps" | "complete" | "error";
	currentChunk: number;
	totalChunks: number;
	personasExtracted: number;
	flowsExtracted: number;
	stepsExtracted: number;
	message: string;
	percentage: number;
	error?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Fetch flows and personas for the project and render a simple ASCII graph
 * (personas → flows → pages) so the user can see the graph created by init.
 */
async function renderBootstrapGraph(client: InstanceType<typeof PerceoDataClient>, projectId: string): Promise<void> {
	try {
		const [flows, personas] = await Promise.all([client.getFlows(projectId), client.getPersonas(projectId)]);
		if (flows.length === 0) {
			console.log(chalk.gray("\n  No flows to display in graph.\n"));
			return;
		}

		const personaById = new Map<string, Persona>();
		for (const p of personas) {
			personaById.set(p.id, p);
		}

		// Group flows by persona (include flows with no persona)
		const byPersona = new Map<string, Flow[]>();
		const noPersona: Flow[] = [];
		for (const f of flows) {
			if (f.persona_id) {
				const list = byPersona.get(f.persona_id) ?? [];
				list.push(f);
				byPersona.set(f.persona_id, list);
			} else {
				noPersona.push(f);
			}
		}

		// Order: personas by name, then "Flows (no persona)" if any
		const personaIds = [...byPersona.keys()].sort((a, b) => {
			const na = personaById.get(a)?.name ?? "";
			const nb = personaById.get(b)?.name ?? "";
			return na.localeCompare(nb);
		});

		const width = 52;
		console.log("\n" + chalk.bold("  Graph (personas → flows → pages)"));
		console.log(chalk.cyan("  " + "═".repeat(width)));

		for (const pid of personaIds) {
			const persona = personaById.get(pid);
			const name = persona?.name ?? "Unknown";
			const list = byPersona.get(pid) ?? [];
			console.log(chalk.gray("  ") + chalk.bold(persona ? chalk.magenta("▸ " + name) : "▸ " + name));

			for (let i = 0; i < list.length; i++) {
				const flow = list[i];
				const isLastFlow = i === list.length - 1;
				const flowBranch = isLastFlow ? "└" : "├";
				const flowPrefix = "  │  ";
				const pages = (flow?.graph_data?.pages as string[] | undefined) ?? [];
				const pageStr = pages.length > 0 ? pages.join(" → ") : "(no pages)";
				console.log(chalk.gray(flowPrefix + flowBranch + "─ ") + chalk.cyan(flow?.name ?? "Unknown"));
				console.log(chalk.gray(flowPrefix + "   ") + chalk.gray(pageStr));
			}
		}

		if (noPersona.length > 0) {
			console.log(chalk.gray("  ") + chalk.bold(chalk.dim("▸ (no persona)")));
			for (let i = 0; i < noPersona.length; i++) {
				const flow = noPersona[i];
				const isLastFlow = i === noPersona.length - 1;
				const flowBranch = isLastFlow ? "└" : "├";
				const pages = (flow?.graph_data?.pages as string[] | undefined) ?? [];
				const pageStr = pages.length > 0 ? pages.join(" → ") : "(no pages)";
				console.log(chalk.gray("  │  " + flowBranch + "─ ") + chalk.cyan(flow?.name ?? "Unknown"));
				console.log(chalk.gray("  │     ") + chalk.gray(pageStr));
			}
		}

		console.log(chalk.cyan("  " + "═".repeat(width)) + "\n");
	} catch (err) {
		console.log(chalk.gray("\n  Could not load graph for display: " + (err instanceof Error ? err.message : String(err)) + "\n"));
	}
}

async function readPackageJson(projectDir: string): Promise<PackageJson | null> {
	const pkgPath = path.join(projectDir, "package.json");
	if (!(await fileExists(pkgPath))) return null;

	try {
		const raw = await fs.readFile(pkgPath, "utf8");
		return JSON.parse(raw) as PackageJson;
	} catch {
		return null;
	}
}

async function detectFramework(projectDir: string, pkg: PackageJson | null): Promise<string> {
	const nextConfig = await fileExists(path.join(projectDir, "next.config.js"));
	const nextConfigTs = await fileExists(path.join(projectDir, "next.config.ts"));
	if (nextConfig || nextConfigTs) return "nextjs";

	const remixConfig = await fileExists(path.join(projectDir, "remix.config.js"));
	if (remixConfig) return "remix";

	const deps = {
		...(pkg?.dependencies || {}),
		...(pkg?.devDependencies || {}),
	};

	if (deps["next"]) return "nextjs";
	if (deps["react"] || deps["react-dom"]) return "react";
	if (deps["@remix-run/react"]) return "remix";
	if (deps["@angular/core"]) return "angular";
	if (deps["vue"]) return "vue";

	return "unknown";
}

async function fileExists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

async function dirExists(p: string): Promise<boolean> {
	try {
		const stat = await fs.stat(p);
		return stat.isDirectory();
	} catch {
		return false;
	}
}

/**
 * Detect the default branch from git repository.
 * Tries multiple methods to find the correct default branch.
 */
function detectDefaultBranch(projectDir: string): string {
	// Method 1: Try to get the default branch from the remote
	try {
		const result = execSync("git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'", {
			cwd: projectDir,
			encoding: "utf-8",
		}).trim();
		if (result) return result;
	} catch {
		// Fall through to next method
	}

	// Method 2: Check which branch we're currently on
	try {
		const currentBranch = execSync("git branch --show-current", {
			cwd: projectDir,
			encoding: "utf-8",
		}).trim();
		if (currentBranch) return currentBranch;
	} catch {
		// Fall through to next method
	}

	// Method 3: Check if main exists
	try {
		execSync("git rev-parse --verify main", {
			cwd: projectDir,
			encoding: "utf-8",
			stdio: "pipe",
		});
		return "main";
	} catch {
		// Fall through to next method
	}

	// Method 4: Check if master exists
	try {
		execSync("git rev-parse --verify master", {
			cwd: projectDir,
			encoding: "utf-8",
			stdio: "pipe",
		});
		return "master";
	} catch {
		// Fall through to default
	}

	// Default fallback
	return "main";
}

function createDefaultConfig(projectName: string, framework: string, projectId: string | null, branch: string) {
	return {
		version: "1.0",
		project: {
			id: projectId,
			name: projectName,
			framework,
			branch,
		},
		observer: {
			watch: {
				paths: inferDefaultWatchPaths(framework),
				ignore: ["node_modules/", ".next/", "dist/", "build/"],
				debounceMs: 500,
			},
		},
	};
}

function inferDefaultWatchPaths(framework: string): string[] {
	switch (framework) {
		case "nextjs":
			return ["app/", "src/"];
		case "react":
			return ["src/"];
		case "remix":
			return ["app/"];
		case "angular":
			return ["src/"];
		case "vue":
			return ["src/"];
		default:
			return ["src/"];
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPerceoReadme(projectName: string): string {
	return `# Perceo configuration for ${projectName}

This folder was generated by \`perceo init\`.

## Files

- \`.perceo/config.json\` — project configuration (project id, name, branch). Access to this project is controlled in Perceo Cloud; only users added as members can view or change project data.

## Commands

- \`perceo analyze --base <branch>\` — analyze PR changes and find affected flows
- \`perceo flows list\` — list all discovered flows

## Environment Variables

Set these to enable Supabase sync:

\`\`\`bash
PERCEO_SUPABASE_URL=https://your-project.supabase.co
PERCEO_SUPABASE_ANON_KEY=your-anon-key
\`\`\`
`;
}

function generateGitHubWorkflow(branch: string): string {
	// Support both the configured branch and common alternatives (main/master)
	const branches = Array.from(new Set([branch, "main", "master"])).join(", ");

	return `# Perceo CI - Automated regression impact analysis
# Generated by perceo init
# Docs: https://perceo.dev/docs/ci

name: Perceo CI

on:
  pull_request:
    branches: [${branches}]
  push:
    branches: [${branches}]

permissions:
  contents: read
  pull-requests: write  # For PR comments

jobs:
  analyze:
    name: Analyze Changes
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for accurate diff
      
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install Perceo CLI
        run: npm install -g @perceo/perceo
      
      - name: Analyze PR Changes
        if: github.event_name == 'pull_request'
        env:
          PERCEO_API_KEY: \${{ secrets.PERCEO_API_KEY }}
        run: |
          perceo ci analyze \\
            --base \${{ github.event.pull_request.base.sha }} \\
            --head \${{ github.sha }} \\
            --pr \${{ github.event.pull_request.number }}
      
      - name: Analyze Push Changes
        if: github.event_name == 'push'
        env:
          PERCEO_API_KEY: \${{ secrets.PERCEO_API_KEY }}
        run: |
          perceo ci analyze \\
            --base \${{ github.event.before }} \\
            --head \${{ github.sha }}
`;
}
