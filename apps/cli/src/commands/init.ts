import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config.js";
import { ObserverEngine, type ObserverEngineConfig } from "@perceo/observer-engine";

type InitOptions = {
	dir: string;
};

type PackageJson = {
	name?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};

const CONFIG_DIR = ".perceo";
const CONFIG_FILE = "config.json";

export const initCommand = new Command("init")
	.description("Initialize Perceo in your project")
	.option("-d, --dir <directory>", "Project directory", process.cwd())
	.action(async (options: InitOptions) => {
		const projectDir = path.resolve(options.dir || process.cwd());
		const spinner = ora(`Initializing Perceo in ${chalk.cyan(projectDir)}...`).start();

		try {
			const pkg = await readPackageJson(projectDir);
			const projectName = pkg?.name || path.basename(projectDir);
			const framework = await detectFramework(projectDir, pkg);

			const perceoDir = path.join(projectDir, CONFIG_DIR);
			const perceoConfigPath = path.join(perceoDir, CONFIG_FILE);

			// Ensure .perceo directory exists
			await fs.mkdir(perceoDir, { recursive: true });

			// If config already exists, do not overwrite – just inform the user
			if (await fileExists(perceoConfigPath)) {
				spinner.stop();
				console.log(chalk.yellow(`\n.perceo/${CONFIG_FILE} already exists. Skipping config generation.`));
			} else {
				const config = createDefaultConfig(projectName, framework);
				await fs.writeFile(perceoConfigPath, JSON.stringify(config, null, 2) + "\n", "utf8");
			}

			// Create a minimal README to point to managed services setup
			const readmePath = path.join(perceoDir, "README.md");
			if (!(await fileExists(readmePath))) {
				await fs.writeFile(readmePath, createPerceoReadme(projectName), "utf8");
			}

			// Initialize flows/personas via Observer Engine when possible.
			let bootstrapSummary: string | null = null;
			try {
				spinner.text = "Initializing flows and personas with Perceo Observer Engine...";

				const config = await loadConfig({ projectDir });
				const observerConfig: ObserverEngineConfig = {
					observer: config.observer,
					flowGraph: config.flowGraph,
					eventBus: config.eventBus,
				};

				const engine = new ObserverEngine(observerConfig);
				const result = await engine.bootstrapProject({
					projectDir,
					projectName,
					framework,
				});

				const warnings = result.warnings && result.warnings.length > 0 ? ` (${result.warnings.length} warning${result.warnings.length > 1 ? "s" : ""})` : "";
				bootstrapSummary = `Initialized ${result.flowsInitialized} flow(s) and ${result.personasInitialized} persona(s)${warnings}.`;
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				console.log(chalk.yellow(`\n⚠️  Skipped automatic Observer bootstrap. You can configure managed services later. Details: ${message}`));
			}

			spinner.succeed("Perceo initialized successfully!");

			console.log("\n" + chalk.bold("Project: ") + projectName);
			console.log(chalk.bold("Detected framework: ") + framework);
			console.log(chalk.bold("Config: ") + path.relative(projectDir, perceoConfigPath));
			if (bootstrapSummary) {
				console.log(chalk.bold("Observer bootstrap: ") + bootstrapSummary);
			}

			console.log("\n" + chalk.bold("Next steps:"));
			console.log("  1. Review and customize " + chalk.cyan(`.perceo/${CONFIG_FILE}`) + " for your project.");
			console.log("  2. Set up local managed services (Neo4j, Supabase) as described in " + chalk.cyan(".perceo/README.md") + ".");
			console.log("  3. Start the watcher with: " + chalk.cyan("perceo watch --dev --analyze"));
			console.log("\n" + chalk.gray("For full architecture and managed services guides, see docs/cli_architecture.md."));
		} catch (error) {
			spinner.fail("Failed to initialize Perceo");
			console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
			process.exit(1);
		}
	});

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
	// 1. File-based heuristics
	const nextConfig = await fileExists(path.join(projectDir, "next.config.js"));
	const nextConfigTs = await fileExists(path.join(projectDir, "next.config.ts"));
	if (nextConfig || nextConfigTs) return "nextjs";

	const remixConfig = await fileExists(path.join(projectDir, "remix.config.js"));
	if (remixConfig) return "remix";

	// 2. Dependency-based heuristics
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

function createDefaultConfig(projectName: string, framework: string) {
	return {
		version: "1.0",
		project: {
			name: projectName,
			framework,
		},
		observer: {
			watch: {
				paths: inferDefaultWatchPaths(framework),
				ignore: ["node_modules/", ".next/", "dist/", "build/"],
				debounceMs: 500,
				autoTest: true,
			},
			ci: {
				strategy: "affected-flows",
				parallelism: 5,
			},
			analysis: {
				useLLM: true,
				llmThreshold: 0.7,
			},
		},
		analyzer: {
			insights: {
				enabled: true,
				updateInterval: 3600,
				minSeverity: "medium",
			},
			predictions: {
				enabled: true,
				model: "ml",
				confidenceThreshold: 0.6,
			},
			coverage: {
				minCoverageScore: 0.7,
				alertOnGaps: true,
			},
		},
		analytics: {
			provider: "ga4",
			credentials: "${ANALYTICS_CREDENTIALS}",
			syncInterval: 300,
			correlation: {
				algorithm: "smith-waterman",
				minSimilarity: 0.7,
			},
			revenueTracking: {
				enabled: true,
				avgOrderValueSource: "analytics",
			},
		},
		flowGraph: {
			endpoint: "bolt://localhost:7687",
			database: "Perceo",
		},
		eventBus: {
			type: "in-memory",
			redisUrl: "redis://localhost:6379",
		},
		notifications: {
			slack: {
				enabled: false,
				webhook: "",
			},
			email: {
				enabled: false,
				recipients: [],
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

This folder was generated by \`perceo init\` and contains configuration for the Perceo CLI.

## Files

- \`.perceo/config.json\` — main configuration file for the Perceo CLI.

## What this config does

- Tells the Perceo backend which project and framework you are using.
- Configures how the Observer, Analyzer, and Analytics features should behave for this project.
- Stores connection settings that the Perceo backend and packages use to talk to managed services.

The actual connection logic and authentication to Perceo-managed services (including any databases, event buses, or analytics backends) is handled by Perceo’s backend packages and platform — not by this CLI config.

In most cases you should only need to:

1. Review \`.perceo/config.json\` and adjust paths (for example, \`src/\` vs \`app/\`).
2. Commit \`.perceo/config.json\` to your repository (if you want it shared with your team).
3. Run:

\`\`\`bash
perceo watch --dev --analyze
\`\`\`

to start Perceo in your local development workflow.
`;
}
