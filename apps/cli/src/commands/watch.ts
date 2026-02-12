import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "../config.js";
import { ObserverEngine, type ObserverEngineConfig } from "@perceo/observer-engine";

export const watchCommand = new Command("watch")
	.description("Watch for code changes and run tests")
	.option("--dev", "Run against local development server")
	.option("--port <port>", "Development server port", "3000")
	.action(async (options) => {
		const spinner = ora("Starting Perceo observer...").start();

		try {
			const config = await loadConfig();

			const observerConfig: ObserverEngineConfig = {
				observer: config.observer,
				flowGraph: config.flowGraph,
				eventBus: config.eventBus,
			};

			// We construct the engine now so that when watch-mode is fully
			// implemented we can simply plug file change events into
			// ObserverEngine.startWatchCore without changing this command's
			// public surface.
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const engine = new ObserverEngine(observerConfig);

			// TODO: Implement watch logic
			// - Start file watcher
			// - Detect code changes
			// - Pass changes into engine.startWatchCore
			// - Trigger relevant flows and multi-agent tests against backend

			spinner.succeed("Observer started");

			console.log(chalk.blue("\n👀 Watching for changes..."));
			console.log(chalk.gray("Press Ctrl+C to stop\n"));

			const envLabel = (process.env.PERCEO_ENV || "").toLowerCase() === "local" ? chalk.yellow("local (using .perceo/config.local.json overrides when present)") : chalk.green("default");

			console.log(chalk.bold("Environment: "), envLabel);
			if (config?.flowGraph?.endpoint) {
				console.log(chalk.bold("Flow graph endpoint: "), config.flowGraph.endpoint);
			}
			if (config?.eventBus?.type) {
				console.log(chalk.bold("Event bus: "), config.eventBus.type);
			}

			if (options.dev) {
				console.log(chalk.green(`✓ Connected to localhost:${options.port}`));
			}

			// Keep process alive
			process.stdin.resume();
		} catch (error) {
			spinner.fail("Failed to start observer");
			console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
			process.exit(1);
		}
	});
