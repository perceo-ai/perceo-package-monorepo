import { ClaudeClient, Persona, Flow, Step } from "../utils/claude";
import { getGitDiff, getCurrentCommit, getChangedFiles } from "../utils/git-ops";
import { execSync } from "child_process";

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
}

/**
 * Extract personas from git diff using Claude
 */
export async function extractPersonasFromDiffActivity(input: ExtractPersonasInput): Promise<Persona[]> {
	const { projectDir, baseSha, headSha, framework, anthropicApiKey, useOpenRouter } = input;

	console.log(`[EXTRACTION] Starting persona extraction from diff ${baseSha}...${headSha}`);
	console.log(`[EXTRACTION] Project directory: ${projectDir}`);
	console.log(`[EXTRACTION] Framework: ${framework}`);
	console.log(`[EXTRACTION] Using OpenRouter: ${useOpenRouter}`);
	console.log(`[EXTRACTION] API key configured: ${anthropicApiKey ? "Yes" : "No"}`);

	const startTime = Date.now();

	// Get git diff
	console.log(`[EXTRACTION] Getting git diff between ${baseSha} and ${headSha}`);
	const diff = getGitDiff(projectDir, baseSha, headSha);

	if (!diff || diff.trim().length === 0) {
		console.log(`[EXTRACTION] No diff found between commits, skipping persona extraction`);
		return [];
	}

	console.log(`[EXTRACTION] Diff size: ${diff.length} characters`);
	console.log(`[EXTRACTION] Diff preview (first 200 chars): ${diff.substring(0, 200)}...`);

	// Extract personas using Claude
	console.log(`[EXTRACTION] Initializing Claude client for persona extraction`);
	const claude = new ClaudeClient(anthropicApiKey, useOpenRouter);

	console.log(`[EXTRACTION] Calling Claude API for persona extraction`);
	const personas = await claude.extractPersonasFromDiff(diff, framework);

	const duration = Date.now() - startTime;
	console.log(`[EXTRACTION] Persona extraction completed in ${duration}ms`);
	console.log(`[EXTRACTION] Extracted ${personas.length} personas from chunk`);

	if (personas.length > 0) {
		console.log(`[EXTRACTION] Persona names: ${personas.map((p) => p.name).join(", ")}`);
	}

	return personas;
}

/**
 * Extract flows from git diff for a specific persona using LLM
 * One LLM call per persona for more focused extraction
 */
export async function extractFlowsFromDiffActivity(input: ExtractFlowsInput): Promise<Flow[]> {
	const { projectDir, baseSha, headSha, framework, persona, anthropicApiKey, useOpenRouter } = input;

	console.log(`[EXTRACTION] Starting flow extraction for persona "${persona.name}"`);
	console.log(`[EXTRACTION] Diff range: ${baseSha}...${headSha}`);
	console.log(`[EXTRACTION] Project directory: ${projectDir}`);
	console.log(`[EXTRACTION] Framework: ${framework}`);
	console.log(`[EXTRACTION] Using OpenRouter: ${useOpenRouter}`);
	console.log(`[EXTRACTION] Persona behaviors: ${JSON.stringify(persona.behaviors)}`);

	const startTime = Date.now();

	// Get git diff
	console.log(`[EXTRACTION] Getting git diff for flow extraction`);
	const diff = getGitDiff(projectDir, baseSha, headSha);

	if (!diff || diff.trim().length === 0) {
		console.log(`[EXTRACTION] No diff found, skipping flow extraction for persona "${persona.name}"`);
		return [];
	}

	console.log(`[EXTRACTION] Diff size for flow extraction: ${diff.length} characters`);

	// Extract flows for this persona using LLM
	console.log(`[EXTRACTION] Initializing Claude client for flow extraction`);
	const claude = new ClaudeClient(anthropicApiKey, useOpenRouter);

	console.log(`[EXTRACTION] Calling Claude API for flow extraction for persona "${persona.name}"`);
	const flows = await claude.extractFlowsForPersona(diff, framework, persona);

	const duration = Date.now() - startTime;
	console.log(`[EXTRACTION] Flow extraction completed in ${duration}ms for persona "${persona.name}"`);
	console.log(`[EXTRACTION] Extracted ${flows.length} flows for persona "${persona.name}"`);

	if (flows.length > 0) {
		console.log(`[EXTRACTION] Flow names: ${flows.map((f) => f.name).join(", ")}`);
	}

	return flows;
}

/**
 * Extract detailed steps for a specific flow using Claude
 */
export async function extractStepsForFlowActivity(input: ExtractStepsInput): Promise<Step[]> {
	const { projectDir, flowId, flowName, flowDescription, framework, branch, anthropicApiKey, useOpenRouter } = input;

	console.log(`[EXTRACTION] Starting step extraction for flow: ${flowName}`);
	console.log(`[EXTRACTION] Flow ID: ${flowId}`);
	console.log(`[EXTRACTION] Flow description: ${flowDescription}`);
	console.log(`[EXTRACTION] Project directory: ${projectDir}`);
	console.log(`[EXTRACTION] Framework: ${framework}`);
	console.log(`[EXTRACTION] Branch: ${branch}`);
	console.log(`[EXTRACTION] Using OpenRouter: ${useOpenRouter}`);

	const startTime = Date.now();

	// Get relevant files from current codebase (HEAD)
	// Strategy: Get files that likely contain this flow's implementation
	// For now, we'll get all source files and let Claude analyze
	console.log(`[EXTRACTION] Getting relevant code context for step extraction`);
	const codeContext = getRelevantCodeContext(projectDir, framework);

	if (!codeContext || codeContext.trim().length === 0) {
		console.log(`[EXTRACTION] No code context found, skipping step extraction for flow ${flowName}`);
		return [];
	}

	console.log(`[EXTRACTION] Code context size: ${codeContext.length} characters`);

	// Extract steps using Claude
	console.log(`[EXTRACTION] Initializing Claude client for step extraction`);
	const claude = new ClaudeClient(anthropicApiKey, useOpenRouter);

	console.log(`[EXTRACTION] Calling Claude API for step extraction for flow ${flowName}`);
	const steps = await claude.extractStepsForFlow(codeContext, flowName, flowDescription, framework);

	const duration = Date.now() - startTime;
	console.log(`[EXTRACTION] Step extraction completed in ${duration}ms for flow ${flowName}`);
	console.log(`[EXTRACTION] Extracted ${steps.length} steps for flow ${flowName}`);

	if (steps.length > 0) {
		console.log(
			`[EXTRACTION] Step actions: ${steps
				.map((s) => {
					// s.action is either StepAction or string, so handle both
					if (typeof s.action === "object" && s.action !== null && "type" in s.action) {
						// @ts-expect-error (allow any object with 'type')
						return s.action.type;
					} else if (typeof s.action === "string") {
						return s.action;
					} else {
						return "unknown";
					}
				})
				.join(", ")}`,
		);
	}

	return steps;
}

/**
 * Get relevant code context for step extraction
 * This gets the main source files from the current codebase
 */
function getRelevantCodeContext(projectDir: string, framework: string): string {
	console.log(`[CODE_CONTEXT] Starting code context extraction`);
	console.log(`[CODE_CONTEXT] Project directory: ${projectDir}`);
	console.log(`[CODE_CONTEXT] Framework: ${framework}`);

	try {
		// Get all source files based on framework
		const patterns = getSourceFilePatterns(framework);
		let allFiles: string[] = [];

		console.log(`[CODE_CONTEXT] Looking for source files with patterns:`, patterns);

		for (const pattern of patterns) {
			try {
				// Convert glob pattern to find command
				// Remove leading './' for cleaner paths
				const cleanPattern = pattern.replace(/^\.\//, "");

				// Split pattern into directory and file pattern
				const parts = cleanPattern.split("**/");
				let findCmd: string;

				if (parts.length > 1) {
					// Pattern like 'app/**/*.tsx'
					const baseDir = parts[0] || ".";
					const filePattern = parts[parts.length - 1];

					// Use find with -name for the file pattern
					findCmd = `find ${baseDir} -type f -name "${filePattern}" 2>/dev/null | head -50`;
				} else {
					// Pattern like './src/**/*.tsx' without **
					const lastSlashIndex = cleanPattern.lastIndexOf("/");
					const baseDir = lastSlashIndex > 0 ? cleanPattern.substring(0, lastSlashIndex) : ".";
					const filePattern = lastSlashIndex > 0 ? cleanPattern.substring(lastSlashIndex + 1) : cleanPattern;

					findCmd = `find ${baseDir} -type f -name "${filePattern}" 2>/dev/null | head -50`;
				}

				console.log(`[CODE_CONTEXT] Executing: ${findCmd}`);
				const output = execSync(findCmd, {
					cwd: projectDir,
					encoding: "utf-8",
					maxBuffer: 10 * 1024 * 1024,
				}).trim();

				if (output) {
					const files = output.split("\n").filter((f) => f.length > 0);
					console.log(`[CODE_CONTEXT] Found ${files.length} files matching ${pattern}`);
					allFiles = allFiles.concat(files);
				}
			} catch (err) {
				// Pattern might not match anything or directory doesn't exist
				console.log(`[CODE_CONTEXT] No files found for pattern ${pattern}: ${err instanceof Error ? err.message : String(err)}`);
				continue;
			}
		}

		console.log(`[CODE_CONTEXT] Total files found: ${allFiles.length}`);

		if (allFiles.length === 0) {
			console.log(`[CODE_CONTEXT] No source files found in project directory`);
			return "";
		}

		// Remove duplicates
		const uniqueFiles = Array.from(new Set(allFiles));
		console.log(`[CODE_CONTEXT] Unique files after deduplication: ${uniqueFiles.length}`);

		// Read content of all files (limit to first 50 files to avoid token overflow)
		const filesToRead = uniqueFiles.slice(0, 50);
		console.log(`[CODE_CONTEXT] Reading ${filesToRead.length} files for code context`);

		const fileContents = filesToRead
			.map((file) => {
				try {
					const content = execSync(`cat "${file}"`, {
						cwd: projectDir,
						encoding: "utf-8",
						maxBuffer: 1024 * 1024, // 1MB per file
					});
					return `\n--- ${file} ---\n${content}`;
				} catch (err) {
					console.error(`[CODE_CONTEXT] Failed to read file ${file}:`, err);
					return "";
				}
			})
			.filter((content) => content.length > 0);

		const totalContext = fileContents.join("\n");
		console.log(`[CODE_CONTEXT] Code context size: ${totalContext.length} characters`);
		console.log(`[CODE_CONTEXT] Successfully read ${fileContents.length} files`);

		return totalContext;
	} catch (error) {
		console.error(`[CODE_CONTEXT] Failed to get code context:`, error);
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
