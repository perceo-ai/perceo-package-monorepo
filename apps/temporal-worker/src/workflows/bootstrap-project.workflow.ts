import { proxyActivities, defineQuery, setHandler } from "@temporalio/workflow";
import type * as activities from "../activities";
import type { UUID } from "@perceo/supabase";

// Proxy activities with appropriate timeouts
const {
	validateWorkflowStartActivity,
	cloneRepositoryActivity,
	cleanupRepositoryActivity,
	getCommitHistoryActivity,
	extractPersonasFromDiffActivity,
	extractFlowsFromDiffActivity,
	extractStepsForFlowActivity,
	persistPersonasActivity,
	persistFlowsActivity,
	persistStepsActivity,
	loadPersonasFromSupabaseActivity,
} = proxyActivities<typeof activities>({
	startToCloseTimeout: "10 minutes",
	retry: {
		initialInterval: "1s",
		maximumInterval: "60s",
		backoffCoefficient: 2,
		maximumAttempts: 3,
	},
});

// Workflow input
export interface BootstrapProjectInput {
	projectId: string;
	gitRemoteUrl: string; // Git remote URL to clone
	projectName: string;
	framework: string;
	branch: string;
	workflowApiKey: string; // Project-scoped API key for workflow authorization
	supabaseUrl: string;
	supabaseServiceRoleKey: string;
	llmApiKey: string; // Global LLM API key passed from worker environment
	useOpenRouter: boolean; // Whether to use OpenRouter (true) or direct Anthropic (false)
	useCustomPersonas?: boolean; // Whether to use user-configured personas instead of auto-generating
}

// Workflow output
export interface BootstrapProjectResult {
	projectId: string;
	personasExtracted: number;
	flowsExtracted: number;
	stepsExtracted: number;
	totalCommitsProcessed: number;
}

// Progress tracking
export interface BootstrapProgress {
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

// Internal state
let currentProgress: BootstrapProgress = {
	stage: "init",
	currentChunk: 0,
	totalChunks: 0,
	personasExtracted: 0,
	flowsExtracted: 0,
	stepsExtracted: 0,
	message: "Initializing bootstrap workflow",
	percentage: 0,
};

// Define progress query
export const progressQuery = defineQuery<BootstrapProgress>("progress");

// Chunk size for commit processing
const CHUNK_SIZE = 25;

/**
 * Main bootstrap workflow
 *
 * Phases:
 * 1. Validate API key (security)
 * 2. Get git commit history
 * 3. Extract personas from git history in chunks
 * 4. Extract flows from git history in chunks
 * 5. Extract steps for each flow from current codebase
 */
export async function bootstrapProjectWorkflow(input: BootstrapProjectInput): Promise<BootstrapProjectResult> {
	const { projectId, gitRemoteUrl, framework, branch, workflowApiKey, supabaseUrl, supabaseServiceRoleKey, llmApiKey, useOpenRouter, useCustomPersonas } = input;

	// Set up progress query handler
	setHandler(progressQuery, () => currentProgress);

	// Track the cloned project directory for cleanup
	let projectDir: string | null = null;

	console.log("=== Bootstrap Project Workflow Started ===");
	console.log(`[WORKFLOW] Project ID: ${projectId}`);
	console.log(`[WORKFLOW] Project Name: ${input.projectName}`);
	console.log(`[WORKFLOW] Git Remote: ${gitRemoteUrl}`);
	console.log(`[WORKFLOW] Framework: ${framework}`);
	console.log(`[WORKFLOW] Branch: ${branch}`);
	console.log(`[WORKFLOW] Using OpenRouter: ${useOpenRouter}`);
	console.log(`[WORKFLOW] Use Custom Personas: ${useCustomPersonas || false}`);
	console.log(`[WORKFLOW] Supabase URL: ${supabaseUrl}`);
	console.log(`[WORKFLOW] Workflow API Key: ${workflowApiKey ? workflowApiKey.substring(0, 12) + "..." : "Not provided"}`);
	console.log(`[WORKFLOW] LLM API Key: ${llmApiKey ? "Configured" : "Not configured"}`);

	try {
		// ========================================================================
		// Phase 0: Security - Validate API key
		// ========================================================================
		currentProgress = {
			...currentProgress,
			stage: "validating",
			message: "Validating workflow authorization",
			percentage: 5,
		};

		console.log(`[WORKFLOW] Validating workflow authorization...`);
		await validateWorkflowStartActivity({
			apiKey: workflowApiKey,
			projectId,
			supabaseUrl,
			supabaseServiceRoleKey,
		});
		console.log(`[WORKFLOW] ✓ Workflow authorization validated`);

		// Validate LLM API key is present (passed from worker environment)
		if (!llmApiKey) {
			currentProgress = {
				...currentProgress,
				stage: "error",
				message: "LLM API key not configured",
				error: "Missing LLM API key in worker configuration",
			};
			throw new Error("LLM API key not configured. Please set PERCEO_ANTHROPIC_API_KEY in worker environment.");
		}

		// ========================================================================
		// Phase 0.5: Clone the repository
		// ========================================================================
		currentProgress = {
			...currentProgress,
			stage: "git-scan",
			message: "Cloning repository...",
			percentage: 8,
		};

		console.log(`[WORKFLOW] Cloning repository: ${gitRemoteUrl}`);
		const cloneResult = await cloneRepositoryActivity({
			gitRemoteUrl,
			branch,
		});
		projectDir = cloneResult.projectDir;

		console.log(`[WORKFLOW] ✓ Repository cloned to: ${projectDir}`);

		// ========================================================================
		// Phase 1: Git Scan - Get all commit history
		// ========================================================================
		currentProgress = {
			...currentProgress,
			stage: "git-scan",
			message: "Scanning git commit history",
			percentage: 10,
		};

		console.log(`[WORKFLOW] Getting commit history for branch: ${branch}`);
		const allCommits = await getCommitHistoryActivity({
			projectDir,
			branch,
		});

		if (allCommits.length === 0) {
			console.log(`[WORKFLOW] ✗ No commits found in repository`);
			throw new Error("No commits found in repository");
		}

		console.log(`[WORKFLOW] ✓ Found ${allCommits.length} commits in repository`);

		// Split commits into chunks
		const chunks = chunkArray(allCommits, CHUNK_SIZE);
		console.log(`[WORKFLOW] Split commits into ${chunks.length} chunks of size ${CHUNK_SIZE}`);

		currentProgress = {
			...currentProgress,
			totalChunks: chunks.length,
			message: `Found ${allCommits.length} commits, processing in ${chunks.length} chunks`,
			percentage: 15,
		};

		// ========================================================================
		// Phase 2: Load or Extract Personas
		// ========================================================================
		console.log(`[WORKFLOW] === Phase 2: Load or Extract Personas ===`);

		let allPersonas: any[] = [];
		let personaIds: string[] = [];

		if (useCustomPersonas) {
			// Load user-configured personas from Supabase
			console.log(`[WORKFLOW] Loading user-configured personas from database`);
			currentProgress = {
				...currentProgress,
				stage: "extract-personas",
				message: "Loading user-configured personas",
				percentage: 20,
			};

			const personasResult = await loadPersonasFromSupabaseActivity({
				projectId,
				source: "user_configured",
				supabaseUrl,
				supabaseServiceRoleKey,
			});

			allPersonas = personasResult.personas;
			personaIds = allPersonas.map((p) => p.id);

			console.log(`[WORKFLOW] ✓ Loaded ${allPersonas.length} user-configured personas`);

			currentProgress = {
				...currentProgress,
				personasExtracted: allPersonas.length,
				message: "User-configured personas loaded",
				percentage: 40,
			};
		} else {
			// Extract personas from git history
			console.log(`[WORKFLOW] Auto-generating personas from git history`);
			currentProgress = {
				...currentProgress,
				stage: "extract-personas",
				message: "Extracting user personas from git history",
				percentage: 20,
			};

			const personasMap = new Map<string, any>();

			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i];
				if (!chunk || chunk.length === 0) continue;

				const baseSha = chunk[0];
				const headSha = chunk[chunk.length - 1];

				if (!baseSha || !headSha) {
					console.log(`[WORKFLOW] Skipping chunk ${i + 1} due to missing SHA values`);
					continue;
				}

				console.log(`[WORKFLOW] Processing persona chunk ${i + 1}/${chunks.length}: ${baseSha}...${headSha}`);
				currentProgress = {
					...currentProgress,
					currentChunk: i + 1,
					message: `Extracting personas (chunk ${i + 1}/${chunks.length})`,
					percentage: 20 + Math.floor((i / chunks.length) * 20),
				};

				// Extract personas from this chunk
				const personas = await extractPersonasFromDiffActivity({
					projectDir,
					baseSha,
					headSha,
					framework,
					anthropicApiKey: llmApiKey,
					useOpenRouter,
				});

				// Merge personas (deduplicate)
				for (const persona of personas) {
					const key = persona.name.toLowerCase();
					if (!personasMap.has(key)) {
						personasMap.set(key, persona);
					} else {
						// Merge behaviors
						const existing = personasMap.get(key);
						const behaviorSet = new Set([...existing.behaviors, ...persona.behaviors]);
						existing.behaviors = Array.from(behaviorSet);
					}
				}

				currentProgress = {
					...currentProgress,
					personasExtracted: personasMap.size,
				};
			}

			allPersonas = Array.from(personasMap.values());
			console.log(`[WORKFLOW] ✓ Persona extraction complete. Total unique personas: ${allPersonas.length}`);

			// Persist personas in batch
			currentProgress = {
				...currentProgress,
				message: "Persisting personas to database",
				percentage: 40,
			};

			console.log(`[WORKFLOW] Persisting ${allPersonas.length} personas to database...`);
			personaIds = await persistPersonasActivity({
				projectId,
				personas: allPersonas,
				supabaseUrl,
				supabaseServiceRoleKey,
			});
			console.log(`[WORKFLOW] ✓ Personas persisted. IDs: ${personaIds.join(", ")}`);
		}

		// Create persona name to ID mapping
		const personaNameToId = new Map<string, UUID>();
		allPersonas.forEach((persona, index) => {
			if (personaIds[index]) {
				personaNameToId.set(persona.name.toLowerCase(), personaIds[index]);
			}
		});

		// ========================================================================
		// Phase 3: Extract Flows (one LLM call per persona per chunk)
		// ========================================================================
		console.log(`[WORKFLOW] === Phase 3: Extract Flows ===`);
		console.log(`[WORKFLOW] Will extract flows for ${allPersonas.length} personas across ${chunks.length} chunks`);

		currentProgress = {
			...currentProgress,
			stage: "extract-flows",
			message: "Extracting user flows from git history",
			percentage: 45,
		};

		const flowsMap = new Map<string, any>();
		const totalFlowExtractions = chunks.length * allPersonas.length;
		let flowExtractionsCompleted = 0;

		console.log(`[WORKFLOW] Total flow extractions to perform: ${totalFlowExtractions}`);

		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i];
			if (!chunk || chunk.length === 0) continue;

			const baseSha = chunk[0];
			const headSha = chunk[chunk.length - 1];

			if (!baseSha || !headSha) {
				console.log(`[WORKFLOW] Skipping flow chunk ${i + 1} due to missing SHA values`);
				continue;
			}

			console.log(`[WORKFLOW] Processing flow chunk ${i + 1}/${chunks.length}: ${baseSha}...${headSha}`);

			// Extract flows for each persona in this chunk
			for (const persona of allPersonas) {
				console.log(`[WORKFLOW] Extracting flows for persona "${persona.name}" in chunk ${i + 1}/${chunks.length}`);

				currentProgress = {
					...currentProgress,
					currentChunk: i + 1,
					message: `Extracting flows for "${persona.name}" (chunk ${i + 1}/${chunks.length})`,
					percentage: 45 + Math.floor((flowExtractionsCompleted / totalFlowExtractions) * 25),
				};

				// Extract flows for this persona from this chunk
				const flows = await extractFlowsFromDiffActivity({
					projectDir,
					baseSha,
					headSha,
					framework,
					persona,
					anthropicApiKey: llmApiKey,
					useOpenRouter,
				});

				// Merge flows (deduplicate by name + persona)
				for (const flow of flows) {
					const key = `${flow.personaName.toLowerCase()}:${flow.name.toLowerCase()}`;
					if (!flowsMap.has(key)) {
						// Add persona ID
						const personaId = personaNameToId.get(flow.personaName.toLowerCase());
						flowsMap.set(key, { ...flow, personaId });
					} else {
						// Merge trigger conditions
						const existing = flowsMap.get(key);
						const triggerSet = new Set([...existing.triggerConditions, ...flow.triggerConditions]);
						existing.triggerConditions = Array.from(triggerSet);
					}
				}

				flowExtractionsCompleted++;
				currentProgress = {
					...currentProgress,
					flowsExtracted: flowsMap.size,
				};
			}
		}

		const allFlows = Array.from(flowsMap.values());
		console.log(`[WORKFLOW] ✓ Flow extraction complete. Total unique flows: ${allFlows.length}`);

		// Persist flows in batch
		currentProgress = {
			...currentProgress,
			message: "Persisting flows to database",
			percentage: 70,
		};

		console.log(`[WORKFLOW] Persisting ${allFlows.length} flows to database...`);
		const flowIds = await persistFlowsActivity({
			projectId,
			flows: allFlows,
			supabaseUrl,
			supabaseServiceRoleKey,
		});
		console.log(`[WORKFLOW] ✓ Flows persisted. IDs: ${flowIds.slice(0, 5).join(", ")}${flowIds.length > 5 ? "..." : ""}`);

		// ========================================================================
		// Phase 4: Extract Steps for Each Flow
		// ========================================================================
		console.log(`[WORKFLOW] === Phase 4: Extract Steps ===`);
		console.log(`[WORKFLOW] Will extract steps for ${allFlows.length} flows`);

		currentProgress = {
			...currentProgress,
			stage: "extract-steps",
			message: "Extracting detailed steps for flows",
			percentage: 75,
		};

		let totalSteps = 0;

		for (let i = 0; i < allFlows.length; i++) {
			const flow = allFlows[i];
			const flowId = flowIds[i];

			if (!flowId) {
				console.log(`[WORKFLOW] Skipping flow ${flow.name} due to missing flow ID`);
				continue;
			}

			console.log(`[WORKFLOW] Extracting steps for flow: ${flow.name} (${i + 1}/${allFlows.length})`);
			currentProgress = {
				...currentProgress,
				message: `Extracting steps for flow: ${flow.name} (${i + 1}/${allFlows.length})`,
				percentage: 75 + Math.floor((i / allFlows.length) * 20),
			};

			// Extract steps for this flow
			const steps = await extractStepsForFlowActivity({
				projectDir,
				flowId,
				flowName: flow.name,
				flowDescription: flow.description,
				framework,
				branch,
				anthropicApiKey: llmApiKey,
				useOpenRouter,
			});

			// Persist steps
			console.log(`[WORKFLOW] Persisting ${steps.length} steps for flow: ${flow.name}`);
			const stepsCreated = await persistStepsActivity({
				flowId,
				steps,
				supabaseUrl,
				supabaseServiceRoleKey,
			});

			console.log(`[WORKFLOW] ✓ Persisted ${stepsCreated} steps for flow: ${flow.name}`);
			totalSteps += stepsCreated;

			currentProgress = {
				...currentProgress,
				stepsExtracted: totalSteps,
			};
		}

		// ========================================================================
		// Complete
		// ========================================================================
		console.log(`[WORKFLOW] === Bootstrap Complete ===`);
		console.log(`[WORKFLOW] Summary:`);
		console.log(`[WORKFLOW]   - Personas extracted: ${personaIds.length}`);
		console.log(`[WORKFLOW]   - Flows extracted: ${flowIds.length}`);
		console.log(`[WORKFLOW]   - Steps extracted: ${totalSteps}`);
		console.log(`[WORKFLOW]   - Commits processed: ${allCommits.length}`);

		currentProgress = {
			...currentProgress,
			stage: "complete",
			message: "Bootstrap complete!",
			percentage: 100,
		};

		// Cleanup: Remove cloned repository
		if (projectDir) {
			try {
				console.log(`[WORKFLOW] Cleaning up cloned repository: ${projectDir}`);
				await cleanupRepositoryActivity({ projectDir });
				console.log(`[WORKFLOW] ✓ Repository cleanup completed`);
			} catch (cleanupError) {
				console.error(`[WORKFLOW] ✗ Failed to cleanup repository, but workflow succeeded:`, cleanupError);
			}
		}

		const result = {
			projectId,
			personasExtracted: personaIds.length,
			flowsExtracted: flowIds.length,
			stepsExtracted: totalSteps,
			totalCommitsProcessed: allCommits.length,
		};

		console.log(`[WORKFLOW] Returning result:`, result);
		return result;
	} catch (error) {
		console.error(`[WORKFLOW] ✗ Bootstrap workflow failed:`, error);

		// Cleanup: Remove cloned repository even on error
		if (projectDir) {
			try {
				console.log(`[WORKFLOW] Cleaning up cloned repository after error: ${projectDir}`);
				await cleanupRepositoryActivity({ projectDir });
				console.log(`[WORKFLOW] ✓ Repository cleanup completed after error`);
			} catch (cleanupError) {
				console.error(`[WORKFLOW] ✗ Failed to cleanup repository after error:`, cleanupError);
			}
		}

		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		console.error(`[WORKFLOW] Final error message: ${errorMessage}`);

		currentProgress = {
			...currentProgress,
			stage: "error",
			message: errorMessage,
			error: errorMessage,
		};
		throw error;
	}
}

/**
 * Split array into chunks
 */
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += chunkSize) {
		chunks.push(array.slice(i, i + chunkSize));
	}
	return chunks;
}
