import { ClaudeClient, Persona, Flow, Step, IdentifiedFlow, PersonaWithFlowNames } from "../utils/claude";
import { getGitDiff, getCurrentCommit, getChangedFiles } from "../utils/git-ops";
import { discoverRouteGraph, type RouteGraphResult } from "../utils/route-discovery";
import { execSync } from "child_process";
import { join } from "path";
import { logger } from "../logger";

export interface ExtractPersonasInput {
	projectDir: string;
	baseSha: string;
	headSha: string;
	framework: string;
	anthropicApiKey: string;
	useOpenRouter: boolean;
}

export interface ExtractFlowsInput {
	projectDir: string;
	baseSha: string;
	headSha: string;
	framework: string;
	persona: Persona;
	anthropicApiKey: string;
	useOpenRouter: boolean;
}

export interface ExtractStepsInput {
	projectDir: string;
	flowId: string;
	flowName: string;
	flowDescription: string;
	framework: string;
	branch: string;
	anthropicApiKey: string;
	useOpenRouter: boolean;
	/** When set, scope code context to these file paths only (flow-scoped, Phase 4) */
	flowPageFilePaths?: string[];
}

export interface DiscoverRouteGraphInput {
	projectDir: string;
	framework: string;
}

export interface IdentifyFlowsFromGraphInput {
	routeGraph: RouteGraphResult;
	framework: string;
	authSnippets?: string;
	anthropicApiKey: string;
	useOpenRouter: boolean;
}

export interface AssignPersonasToFlowsInput {
	identifiedFlows: IdentifiedFlow[];
	framework: string;
	authSnippets?: string;
	anthropicApiKey: string;
	useOpenRouter: boolean;
}

/**
 * Phase 1: Discover route graph (no LLM).
 */
export async function discoverRouteGraphActivity(input: DiscoverRouteGraphInput): Promise<RouteGraphResult> {
	const { projectDir, framework } = input;
	const log = logger.withActivity("discoverRouteGraph");
	log.info("Discovering routes", { projectDir, framework });
	const result = discoverRouteGraph(projectDir, framework);
	log.info("Route graph discovered", {
		routeCount: result.routes.length,
		edgeCount: result.navigationGraph.length,
		framework,
	});
	return result;
}

/**
 * Phase 2: Identify flows from route graph (1-2 LLM calls).
 */
export async function identifyFlowsFromGraphActivity(input: IdentifyFlowsFromGraphInput): Promise<IdentifiedFlow[]> {
	const { routeGraph, framework, authSnippets, anthropicApiKey, useOpenRouter } = input;
	const log = logger.withActivity("identifyFlowsFromGraph");
	log.info("Identifying flows from route graph", {
		routeCount: routeGraph.routes.length,
		framework,
		useOpenRouter,
	});
	const routeList = routeGraph.routes.map((r) => r.path).join("\n");
	const navGraphStr = routeGraph.navigationGraph.map((e) => `${e.from} -> ${e.to}`).join("\n");
	const claude = new ClaudeClient(anthropicApiKey, useOpenRouter);
	const flows = await claude.identifyFlowsFromRouteGraph(routeList, navGraphStr, framework, authSnippets);
	log.info("Flows identified from graph", {
		flowCount: flows.length,
		flowNames: flows.map((f) => f.name),
	});
	return flows;
}

/**
 * Phase 3: Assign personas to flows (1 LLM call).
 */
export async function assignPersonasToFlowsActivity(input: AssignPersonasToFlowsInput): Promise<PersonaWithFlowNames[]> {
	const { identifiedFlows, framework, authSnippets, anthropicApiKey, useOpenRouter } = input;
	const log = logger.withActivity("assignPersonasToFlows");
	log.info("Assigning personas to flows", {
		flowCount: identifiedFlows.length,
		framework,
		useOpenRouter,
	});
	const flowList = identifiedFlows.map((f) => `- ${f.name}: ${f.description} (pages: ${f.pages.join(", ")})`).join("\n");
	const claude = new ClaudeClient(anthropicApiKey, useOpenRouter);
	const personas = await claude.assignPersonasToFlows(flowList, framework, authSnippets);
	log.info("Personas assigned to flows", {
		personaCount: personas.length,
		personaNames: personas.map((p) => p.name),
	});
	return personas;
}

/**
 * Extract personas from git diff using Claude
 */
export async function extractPersonasFromDiffActivity(input: ExtractPersonasInput): Promise<Persona[]> {
	const { projectDir, baseSha, headSha, framework, anthropicApiKey, useOpenRouter } = input;
	const log = logger.withActivity("extractPersonasFromDiff");

	log.info("Starting persona extraction from diff", {
		projectDir,
		baseSha,
		headSha,
		framework,
		useOpenRouter,
		apiKeyConfigured: !!anthropicApiKey,
	});

	const startTime = Date.now();
	const diff = getGitDiff(projectDir, baseSha, headSha);

	if (!diff || diff.trim().length === 0) {
		log.info("No diff found; skipping persona extraction", { baseSha, headSha });
		return [];
	}

	log.info("Got git diff", { diffLength: diff.length, baseSha, headSha });

	const claude = new ClaudeClient(anthropicApiKey, useOpenRouter);
	const personas = await claude.extractPersonasFromDiff(diff, framework);

	const duration = Date.now() - startTime;
	log.info("Persona extraction completed", {
		durationMs: duration,
		personaCount: personas.length,
		personaNames: personas.map((p) => p.name),
	});

	return personas;
}

/**
 * Extract flows from git diff for a specific persona using LLM
 * One LLM call per persona for more focused extraction
 */
export async function extractFlowsFromDiffActivity(input: ExtractFlowsInput): Promise<Flow[]> {
	const { projectDir, baseSha, headSha, framework, persona, anthropicApiKey, useOpenRouter } = input;
	const log = logger.withActivity("extractFlowsFromDiff");

	log.info("Starting flow extraction for persona", {
		projectDir,
		personaName: persona.name,
		baseSha,
		headSha,
		framework,
		useOpenRouter,
	});

	const startTime = Date.now();
	const diff = getGitDiff(projectDir, baseSha, headSha);

	if (!diff || diff.trim().length === 0) {
		log.info("No diff found; skipping flow extraction", { personaName: persona.name });
		return [];
	}

	const claude = new ClaudeClient(anthropicApiKey, useOpenRouter);
	const flows = await claude.extractFlowsForPersona(diff, framework, persona);

	const duration = Date.now() - startTime;
	log.info("Flow extraction completed", {
		durationMs: duration,
		personaName: persona.name,
		flowCount: flows.length,
		flowNames: flows.map((f) => f.name),
	});

	return flows;
}

/**
 * Extract detailed steps for a specific flow using Claude.
 * When flowPageFilePaths is set (route-first bootstrap), scope context to those pages only.
 */
export async function extractStepsForFlowActivity(input: ExtractStepsInput): Promise<Step[]> {
	const { projectDir, flowId, flowName, flowDescription, framework, branch, anthropicApiKey, useOpenRouter, flowPageFilePaths } = input;
	const log = logger.withActivity("extractStepsForFlow");

	log.info("Starting step extraction for flow", {
		flowId,
		flowName,
		projectDir,
		framework,
		branch,
		useOpenRouter,
		flowPageCount: flowPageFilePaths?.length ?? 0,
	});

	const startTime = Date.now();
	const codeContext = flowPageFilePaths?.length ? getRelevantCodeContextForPages(projectDir, flowPageFilePaths) : getRelevantCodeContext(projectDir, framework);

	if (!codeContext || codeContext.trim().length === 0) {
		log.info("No code context found; skipping step extraction", { flowName });
		return [];
	}

	log.info("Got code context", { flowName, contextLength: codeContext.length });

	const claude = new ClaudeClient(anthropicApiKey, useOpenRouter);
	const steps = await claude.extractStepsForFlow(codeContext, flowName, flowDescription, framework);

	const duration = Date.now() - startTime;
	log.info("Step extraction completed", {
		durationMs: duration,
		flowName,
		stepCount: steps.length,
	});

	return steps;
}

/**
 * Get code context scoped to specific page file paths (flow-scoped, Phase 4).
 */
function getRelevantCodeContextForPages(projectDir: string, filePaths: string[]): string {
	const fileContents = filePaths
		.slice(0, 20)
		.map((file) => {
			const fullPath = file.startsWith("/") ? file : join(projectDir, file);
			try {
				const content = execSync(`cat "${fullPath.replace(/"/g, '\\"')}"`, {
					cwd: projectDir,
					encoding: "utf-8",
					maxBuffer: 1024 * 1024,
				});
				return `\n--- ${file} ---\n${content}`;
			} catch {
				return "";
			}
		})
		.filter(Boolean);
	return fileContents.join("\n");
}

/**
 * Get relevant code context for step extraction
 * This gets the main source files from the current codebase
 */
function getRelevantCodeContext(projectDir: string, framework: string): string {
	logger.debug("Starting code context extraction", { projectDir, framework });

	try {
		const patterns = getSourceFilePatterns(framework);
		let allFiles: string[] = [];

		for (const pattern of patterns) {
			try {
				const cleanPattern = pattern.replace(/^\.\//, "");
				const parts = cleanPattern.split("**/");
				let findCmd: string;

				if (parts.length > 1) {
					const baseDir = parts[0] || ".";
					const filePattern = parts[parts.length - 1];
					findCmd = `find ${baseDir} -type f -name "${filePattern}" 2>/dev/null | head -50`;
				} else {
					const lastSlashIndex = cleanPattern.lastIndexOf("/");
					const baseDir = lastSlashIndex > 0 ? cleanPattern.substring(0, lastSlashIndex) : ".";
					const filePattern = lastSlashIndex > 0 ? cleanPattern.substring(lastSlashIndex + 1) : cleanPattern;
					findCmd = `find ${baseDir} -type f -name "${filePattern}" 2>/dev/null | head -50`;
				}

				const output = execSync(findCmd, {
					cwd: projectDir,
					encoding: "utf-8",
					maxBuffer: 10 * 1024 * 1024,
				}).trim();

				if (output) {
					const files = output.split("\n").filter((f) => f.length > 0);
					allFiles = allFiles.concat(files);
				}
			} catch (err) {
				logger.debug("No files found for pattern", {
					pattern,
					error: err instanceof Error ? err.message : String(err),
				});
				continue;
			}
		}

		if (allFiles.length === 0) {
			logger.info("No source files found for code context", { projectDir, framework });
			return "";
		}

		const uniqueFiles = Array.from(new Set(allFiles));
		const filesToRead = uniqueFiles.slice(0, 50);

		const fileContents = filesToRead
			.map((file) => {
				try {
					const content = execSync(`cat "${file}"`, {
						cwd: projectDir,
						encoding: "utf-8",
						maxBuffer: 1024 * 1024,
					});
					return `\n--- ${file} ---\n${content}`;
				} catch (err) {
					logger.warn("Failed to read file for code context", {
						file,
						error: err instanceof Error ? err.message : String(err),
					});
					return "";
				}
			})
			.filter((content) => content.length > 0);

		const totalContext = fileContents.join("\n");
		logger.debug("Code context built", {
			projectDir,
			framework,
			contextLength: totalContext.length,
			fileCount: fileContents.length,
		});

		return totalContext;
	} catch (error) {
		logger.error("Failed to get code context", {
			projectDir,
			framework,
			error: error instanceof Error ? error.message : String(error),
		});
		return "";
	}
}

/**
 * Get source file patterns based on framework
 */
function getSourceFilePatterns(framework: string): string[] {
	switch (framework) {
		case "nextjs":
			return ["./app/**/*.tsx", "./app/**/*.ts", "./pages/**/*.tsx", "./pages/**/*.ts", "./components/**/*.tsx", "./src/app/**/*.tsx", "./src/pages/**/*.tsx", "./src/components/**/*.tsx"];
		case "react":
			return ["./src/**/*.tsx", "./src/**/*.ts", "./components/**/*.tsx", "./pages/**/*.tsx"];
		case "remix":
			return ["./app/routes/**/*.tsx", "./app/routes/**/*.ts", "./app/components/**/*.tsx"];
		default:
			return ["./src/**/*.tsx", "./src/**/*.ts"];
	}
}
