import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "../config.js";
import { ObserverEngine, type ObserverEngineConfig } from "@perceo/observer-engine";

type AnalyzeOptions = {
	base: string;
	head: string;
	projectDir?: string;
	json?: boolean;
};

const ci = new Command("ci").description("CI / PR analysis and testing");

ci.command("analyze")
	.description("Analyze changes between two Git refs and report affected flows")
	.requiredOption("--base <sha>", "Base Git ref / SHA")
	.requiredOption("--head <sha>", "Head Git ref / SHA")
	.option("--project-dir <dir>", "Project directory (defaults to process.cwd())")
	.option("--json", "Print machine-readable JSON output", false)
	.action(async (options: AnalyzeOptions) => {
		const projectRoot = options.projectDir ? options.projectDir : process.cwd();
		const spinner = ora("Analyzing changes with Perceo Observer Engine...").start();

		try {
			const rawConfig = await loadConfig({ projectDir: projectRoot });
			const observerConfig: ObserverEngineConfig = {
				observer: rawConfig.observer,
				flowGraph: rawConfig.flowGraph,
				eventBus: rawConfig.eventBus,
			};

			const engine = new ObserverEngine(observerConfig);

			const report = await engine.analyzeChanges({
				baseSha: options.base,
				headSha: options.head,
				projectRoot,
			});

			spinner.succeed("Analysis complete");

			if (options.json) {
				// Machine-readable output for GitHub Actions or other CI consumers.
				process.stdout.write(JSON.stringify(report, null, 2) + "\n");
				return;
			}

			// Human-friendly summary for terminal usage.
			console.log();
			console.log(chalk.bold("Change: ") + `${report.baseSha}...${report.headSha}`);
			console.log(chalk.bold("Flows affected: ") + report.flows.length);

			if (report.flows.length > 0) {
				console.log();
				for (const flow of report.flows) {
					const risk = flow.riskScore.toFixed(2);
					const confidence = (flow.confidence * 100).toFixed(0) + "%";
					const priority = flow.priority ? ` [${flow.priority}]` : "";
					console.log(`- ${chalk.cyan(flow.name)}${priority} (risk=${risk}, confidence=${confidence})`);
				}
			}

			if (report.changes.length > 0) {
				console.log();
				console.log(chalk.bold("Files changed:"));
				for (const file of report.changes) {
					console.log(`- [${file.status}] ${file.path}`);
				}
			}
		} catch (error) {
			spinner.fail("Analysis failed");
			console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
			process.exit(1);
		}
	});

export const ciCommand = ci;
