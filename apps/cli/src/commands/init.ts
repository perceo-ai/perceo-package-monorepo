import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import { isLoggedIn } from "../auth.js";
import { PerceoDataClient, type FlowInsert, type ApiKeyScope, getSupabaseUrl, getSupabaseAnonKey } from "@perceo/supabase";
import { detectGitHubRemote, authorizeGitHub, createRepositorySecret, checkRepositoryPermissions } from "../github.js";
import { createInterface } from "node:readline";

type InitOptions = {
	dir: string;
	skipGithub: boolean;
};

type PackageJson = {
	name?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};

const CONFIG_DIR = ".perceo";
const CONFIG_FILE = "config.json";

export const initCommand = new Command("init")
	.description("Initialize Perceo in your project and discover flows")
	.option("-d, --dir <directory>", "Project directory", process.cwd())
	.option("--skip-github", "Skip GitHub Actions setup", false)
	.action(async (options: InitOptions) => {
		const projectDir = path.resolve(options.dir || process.cwd());

		const loggedIn = await isLoggedIn(projectDir);
		if (!loggedIn) {
			console.error(
				chalk.red("You must log in first. Run ") +
					chalk.cyan("perceo login") +
					chalk.red(" (or ") +
					chalk.cyan("perceo login --scope global") +
					chalk.red("), then run ") +
					chalk.cyan("perceo init") +
					chalk.red(" again."),
			);
			process.exit(1);
		}

		const spinner = ora(`Initializing Perceo in ${chalk.cyan(projectDir)}...`).start();

		try {
			const pkg = await readPackageJson(projectDir);
			const projectName = pkg?.name || path.basename(projectDir);
			const framework = await detectFramework(projectDir, pkg);

			const perceoDir = path.join(projectDir, CONFIG_DIR);
			const perceoConfigPath = path.join(perceoDir, CONFIG_FILE);

			// Ensure .perceo directory exists
			await fs.mkdir(perceoDir, { recursive: true });

			// Use embedded Perceo Cloud credentials
			const supabaseUrl = getSupabaseUrl();
			const supabaseKey = getSupabaseAnonKey();

			let projectId: string | null = null;
			let flowsDiscovered = 0;
			let flowsNew = 0;

			spinner.text = "Connecting to Perceo Cloud...";
			const client = new PerceoDataClient({ supabaseUrl, supabaseKey });

			// Get or create project
			let project = await client.getProjectByName(projectName);
			if (!project) {
				spinner.text = "Creating project...";
				project = await client.createProject({
					name: projectName,
					framework,
					config: { source: "cli-init" },
				});
			}
			projectId = project.id;

			// Discover and bootstrap flows
			spinner.text = "Discovering flows from codebase...";
			const discoveredFlows = await discoverFlows(projectDir, framework);
			flowsDiscovered = discoveredFlows.length;

			// Check existing flows
			const existingFlows = await client.getFlows(projectId);
			const existingNames = new Set(existingFlows.map(f => f.name));

			// Prepare flows for upsert
			const flowsToUpsert: FlowInsert[] = discoveredFlows.map(flow => ({
				project_id: projectId!,
				name: flow.name,
				description: flow.description,
				priority: flow.priority as "critical" | "high" | "medium" | "low",
				entry_point: flow.entryPoint,
				graph_data: {
					components: flow.components,
					pages: flow.pages,
				},
			}));

			// Upsert flows to Supabase
			spinner.text = "Saving flows to Supabase...";
			await client.upsertFlows(flowsToUpsert);

			flowsNew = discoveredFlows.filter(f => !existingNames.has(f.name)).length;

			// Generate API key and GitHub Actions workflow
			let apiKey: string | null = null;
			let workflowCreated = false;
			let githubAutoConfigured = false;
			
			if (projectId && !options.skipGithub) {
				spinner.text = "Generating CI API key...";
				
				const scopes: ApiKeyScope[] = [
					"ci:analyze",
					"ci:test",
					"flows:read",
					"insights:read",
					"events:publish",
				];

				try {
					const { key } = await client.createApiKey(projectId, {
						name: "github-actions",
						scopes,
					});
					apiKey = key;

					// Detect GitHub remote
					const remote = detectGitHubRemote(projectDir);
					
					if (remote) {
						spinner.stop();
						console.log(chalk.cyan(`\n📦 Detected GitHub repository: ${remote.owner}/${remote.repo}`));
						
						const rl = createInterface({ input: process.stdin, output: process.stdout });
						const answer = await new Promise<string>((resolve) => {
							rl.question(
								chalk.bold("Auto-configure GitHub Actions? (Y/n): "),
								(ans) => {
									rl.close();
									resolve((ans || "y").toLowerCase());
								}
							);
						});

						if (answer === "y" || answer === "yes" || answer === "") {
							try {
								spinner.start("Authorizing with GitHub...");
								const ghAuth = await authorizeGitHub();
								
								spinner.text = "Checking repository permissions...";
								const hasPermission = await checkRepositoryPermissions(
									ghAuth.accessToken,
									remote.owner,
									remote.repo
								);
								
								if (!hasPermission) {
									spinner.warn("Insufficient permissions to write to repository");
									console.log(chalk.yellow("  You need admin or push access to configure secrets automatically."));
								} else {
									spinner.text = "Creating PERCEO_API_KEY secret...";
									await createRepositorySecret(
										ghAuth.accessToken,
										remote.owner,
										remote.repo,
										"PERCEO_API_KEY",
										apiKey
									);
									
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
						const workflowContent = generateGitHubWorkflow();
						await fs.writeFile(workflowPath, workflowContent, "utf8");
						workflowCreated = true;
					}
				} catch (error) {
					// Don't fail init if API key generation fails
					spinner.warn("Continuing without CI setup");
					console.log(chalk.yellow(`  ${error instanceof Error ? error.message : "Unknown error"}`));
				}
			}

			// If config already exists, do not overwrite – just inform the user
			if (await fileExists(perceoConfigPath)) {
				spinner.stop();
				console.log(chalk.yellow(`\n.perceo/${CONFIG_FILE} already exists. Skipping config generation.`));
			} else {
				const config = createDefaultConfig(projectName, framework, projectId);
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
			console.log(chalk.bold("Config: ") + path.relative(projectDir, perceoConfigPath));
			console.log(chalk.bold("Project ID: ") + projectId);
			console.log(chalk.bold("Flows discovered: ") + `${flowsDiscovered} (${flowsNew} new)`);

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
				console.log("  2. Analyze PR changes: " + chalk.cyan("perceo analyze --base main"));
			}
			console.log("\n" + chalk.gray("Run `perceo logout` to sign out if needed."));
		} catch (error) {
			spinner.fail("Failed to initialize Perceo");
			console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
			process.exit(1);
		}
	});

// ============================================================================
// Flow Discovery
// ============================================================================

interface DiscoveredFlow {
	name: string;
	description: string;
	priority: string;
	entryPoint?: string;
	components?: string[];
	pages?: string[];
}

async function discoverFlows(projectRoot: string, framework: string): Promise<DiscoveredFlow[]> {
	const flows: DiscoveredFlow[] = [];

	// Framework-specific discovery
	if (framework === "nextjs") {
		flows.push(...await discoverNextJsFlows(projectRoot));
	} else if (framework === "react") {
		flows.push(...await discoverReactFlows(projectRoot));
	} else {
		flows.push(...await discoverGenericFlows(projectRoot));
	}

	// Always add common flows if patterns exist
	flows.push(...await discoverCommonFlows(projectRoot));

	// Deduplicate by name
	const seen = new Set<string>();
	return flows.filter(f => {
		if (seen.has(f.name)) return false;
		seen.add(f.name);
		return true;
	});
}

async function discoverNextJsFlows(projectRoot: string): Promise<DiscoveredFlow[]> {
	const flows: DiscoveredFlow[] = [];

	const appDir = path.join(projectRoot, "app");
	const srcAppDir = path.join(projectRoot, "src", "app");
	const pagesDir = path.join(projectRoot, "pages");
	const srcPagesDir = path.join(projectRoot, "src", "pages");

	// Discover from App Router
	for (const dir of [appDir, srcAppDir]) {
		if (await dirExists(dir)) {
			const pages = await findNextJsAppPages(dir);
			for (const page of pages) {
				const flowName = pagePathToFlowName(page.route);
				flows.push({
					name: flowName,
					description: `User flow for ${page.route}`,
					priority: inferPriority(page.route),
					entryPoint: page.route,
					pages: [page.file],
				});
			}
		}
	}

	// Discover from Pages Router
	for (const dir of [pagesDir, srcPagesDir]) {
		if (await dirExists(dir)) {
			const pages = await findNextJsPages(dir);
			for (const page of pages) {
				const flowName = pagePathToFlowName(page.route);
				if (!flows.some(f => f.name === flowName)) {
					flows.push({
						name: flowName,
						description: `User flow for ${page.route}`,
						priority: inferPriority(page.route),
						entryPoint: page.route,
						pages: [page.file],
					});
				}
			}
		}
	}

	return flows;
}

async function discoverReactFlows(projectRoot: string): Promise<DiscoveredFlow[]> {
	const flows: DiscoveredFlow[] = [];
	const srcDir = path.join(projectRoot, "src");

	if (await dirExists(srcDir)) {
		for (const subdir of ["pages", "views", "routes", "screens"]) {
			const dir = path.join(srcDir, subdir);
			if (await dirExists(dir)) {
				const files = await findReactComponents(dir);
				for (const file of files) {
					const name = path.basename(file, path.extname(file));
					const flowName = componentToFlowName(name);
					flows.push({
						name: flowName,
						description: `User flow for ${name}`,
						priority: inferPriority(name),
						entryPoint: `/${name.toLowerCase()}`,
						components: [file],
					});
				}
			}
		}
	}

	return flows;
}

async function discoverGenericFlows(projectRoot: string): Promise<DiscoveredFlow[]> {
	return [
		{
			name: "Homepage",
			description: "Main landing page flow",
			priority: "high",
			entryPoint: "/",
		},
	];
}

async function discoverCommonFlows(projectRoot: string): Promise<DiscoveredFlow[]> {
	const flows: DiscoveredFlow[] = [];
	const commonPatterns = [
		{ pattern: /auth|login|signin/i, name: "Authentication", priority: "critical" },
		{ pattern: /signup|register/i, name: "User Registration", priority: "critical" },
		{ pattern: /checkout|payment/i, name: "Checkout", priority: "critical" },
		{ pattern: /cart|basket/i, name: "Shopping Cart", priority: "high" },
		{ pattern: /profile|account|settings/i, name: "User Profile", priority: "medium" },
		{ pattern: /search/i, name: "Search", priority: "high" },
		{ pattern: /dashboard/i, name: "Dashboard", priority: "high" },
	];

	const srcDir = path.join(projectRoot, "src");
	const appDir = path.join(projectRoot, "app");

	for (const dir of [srcDir, appDir]) {
		if (await dirExists(dir)) {
			const files = await walkDir(dir, 3);
			
			for (const { pattern, name, priority } of commonPatterns) {
				const matchingFile = files.find(f => pattern.test(f));
				if (matchingFile && !flows.some(f => f.name === name)) {
					flows.push({
						name,
						description: `${name} user flow`,
						priority,
						components: [matchingFile],
					});
				}
			}
		}
	}

	return flows;
}

// ============================================================================
// Next.js Helpers
// ============================================================================

async function findNextJsAppPages(appDir: string): Promise<{ route: string; file: string }[]> {
	const pages: { route: string; file: string }[] = [];
	
	async function scan(dir: string, route: string): Promise<void> {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			
			if (entry.isDirectory()) {
				if (entry.name.startsWith("_") || entry.name === "api") continue;
				
				const newRoute = entry.name.startsWith("(") 
					? route 
					: `${route}/${entry.name}`;
				
				await scan(fullPath, newRoute);
			} else if (entry.name === "page.tsx" || entry.name === "page.js") {
				pages.push({
					route: route || "/",
					file: path.relative(appDir, fullPath),
				});
			}
		}
	}

	await scan(appDir, "");
	return pages;
}

async function findNextJsPages(pagesDir: string): Promise<{ route: string; file: string }[]> {
	const pages: { route: string; file: string }[] = [];
	
	async function scan(dir: string, route: string): Promise<void> {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			
			if (entry.isDirectory()) {
				if (entry.name === "api" || entry.name.startsWith("_")) continue;
				await scan(fullPath, `${route}/${entry.name}`);
			} else if (/\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.startsWith("_")) {
				const name = entry.name.replace(/\.(tsx?|jsx?)$/, "");
				const pageRoute = name === "index" ? route || "/" : `${route}/${name}`;
				pages.push({
					route: pageRoute,
					file: path.relative(pagesDir, fullPath),
				});
			}
		}
	}

	await scan(pagesDir, "");
	return pages;
}

async function findReactComponents(dir: string): Promise<string[]> {
	const components: string[] = [];
	const entries = await fs.readdir(dir, { withFileTypes: true });
	
	for (const entry of entries) {
		if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) {
			components.push(path.join(dir, entry.name));
		}
	}
	
	return components;
}

async function walkDir(dir: string, maxDepth: number, currentDepth: number = 0): Promise<string[]> {
	if (currentDepth >= maxDepth) return [];
	
	const files: string[] = [];
	
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			
			if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
				files.push(...await walkDir(fullPath, maxDepth, currentDepth + 1));
			} else if (entry.isFile()) {
				files.push(fullPath);
			}
		}
	} catch {
		// Ignore permission errors
	}
	
	return files;
}

// ============================================================================
// Helpers
// ============================================================================

function pagePathToFlowName(route: string): string {
	if (route === "/" || route === "") return "Homepage";
	
	const parts = route.split("/").filter(Boolean);
	return parts
		.map(p => p.replace(/^\[.*\]$/, "").replace(/-/g, " "))
		.filter(Boolean)
		.map(p => p.charAt(0).toUpperCase() + p.slice(1))
		.join(" ") || "Page";
}

function componentToFlowName(name: string): string {
	return name
		.replace(/([A-Z])/g, " $1")
		.replace(/[-_]/g, " ")
		.trim()
		.split(" ")
		.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
		.join(" ");
}

function inferPriority(routeOrName: string): string {
	const critical = /auth|login|checkout|payment|signup|register/i;
	const high = /cart|dashboard|search|profile|account/i;
	const medium = /settings|admin|help/i;

	if (critical.test(routeOrName)) return "critical";
	if (high.test(routeOrName)) return "high";
	if (medium.test(routeOrName)) return "medium";
	if (routeOrName === "/" || routeOrName === "") return "high";
	return "medium";
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

function createDefaultConfig(projectName: string, framework: string, projectId: string | null) {
	return {
		version: "1.0",
		project: {
			id: projectId,
			name: projectName,
			framework,
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

function createPerceoReadme(projectName: string): string {
	return `# Perceo configuration for ${projectName}

This folder was generated by \`perceo init\`.

## Files

- \`.perceo/config.json\` — project configuration

## Commands

- \`perceo analyze --base main\` — analyze PR changes and find affected flows
- \`perceo flows list\` — list all discovered flows

## Environment Variables

Set these to enable Supabase sync:

\`\`\`bash
PERCEO_SUPABASE_URL=https://your-project.supabase.co
PERCEO_SUPABASE_ANON_KEY=your-anon-key
\`\`\`
`;
}

function generateGitHubWorkflow(): string {
	return `# Perceo CI - Automated regression impact analysis
# Generated by perceo init
# Docs: https://perceo.dev/docs/ci

name: Perceo CI

on:
  pull_request:
    branches: [main, master]
  push:
    branches: [main, master]

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
