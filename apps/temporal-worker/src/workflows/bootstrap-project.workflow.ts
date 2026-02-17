import { proxyActivities, defineQuery, setHandler } from "@temporalio/workflow";
import type * as activities from "../activities";
import type { UUID } from "@perceo/supabase";

// Proxy activities with appropriate timeouts
const {
	validateWorkflowStartActivity,
	cloneRepositoryActivity,
	cleanupRepositoryActivity,
	discoverRouteGraphActivity,
	identifyFlowsFromGraphActivity,
	assignPersonasToFlowsActivity,
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
	gitRemoteUrl: string;
	projectName: string;
	framework: string;
	branch: string;
	workflowApiKey: string;
	supabaseUrl: string;
	supabaseServiceRoleKey: string;
	llmApiKey: string;
	useOpenRouter: boolean;
	useCustomPersonas?: boolean;
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
	stage: "init" | "validating" | "clone" | "discover-routes" | "identify-flows" | "assign-personas" | "extract-steps" | "complete" | "error";
	currentChunk: number;
	totalChunks: number;
	personasExtracted: number;
	flowsExtracted: number;
	stepsExtracted: number;
	message: string;
	percentage: number;
	error?: string;
}

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

export const progressQuery = defineQuery<BootstrapProgress>("progress");

/**
 * Main bootstrap workflow (route-first per BOOTSTRAP_SPEC).
 *
 * Phases:
 * 1. Validate API key
 * 2. Clone repository
 * 3. Discover route graph (no LLM)
 * 4. Identify flows from graph (1-2 LLM)
 * 5. Assign personas to flows (1 LLM)
 * 6. Persist personas (or load if useCustomPersonas)
 * 7. Persist flows with graph_data (pages, connectedFlowIds)
 * 8. Extract initial steps per flow (flow-scoped, 1 LLM per flow)
 * 9. Persist steps, cleanup
 */
export async function bootstrapProjectWorkflow(input: BootstrapProjectInput): Promise<BootstrapProjectResult> {
	const { projectId, gitRemoteUrl, framework, branch, workflowApiKey, supabaseUrl, supabaseServiceRoleKey, llmApiKey, useOpenRouter, useCustomPersonas } = input;

	setHandler(progressQuery, () => currentProgress);

	let projectDir: string | null = null;

	console.log("=== Bootstrap Project Workflow Started (route-first) ===");
	console.log(`[WORKFLOW] Project ID: ${projectId}`);
	console.log(`[WORKFLOW] Git Remote: ${gitRemoteUrl}`);
	console.log(`[WORKFLOW] Framework: ${framework}`);
	console.log(`[WORKFLOW] Branch: ${branch}`);

	try {
		// Phase 0: Validate
		currentProgress = { ...currentProgress, stage: "validating", message: "Validating workflow authorization", percentage: 5 };
		await validateWorkflowStartActivity({
			apiKey: workflowApiKey,
			projectId,
			supabaseUrl,
			supabaseServiceRoleKey,
		});
		if (!llmApiKey) {
			currentProgress = { ...currentProgress, stage: "error", message: "LLM API key not configured", error: "Missing LLM API key in worker configuration" };
			throw new Error("LLM API key not configured. Set PERCEO_ANTHROPIC_API_KEY or PERCEO_OPEN_ROUTER_API_KEY in worker environment.");
		}

		// Phase 0.5: Clone
		currentProgress = { ...currentProgress, stage: "clone", message: "Cloning repository...", percentage: 8 };
		const cloneResult = await cloneRepositoryActivity({ gitRemoteUrl, branch });
		projectDir = cloneResult.projectDir;

		// Phase 1: Discover route graph (no LLM)
		currentProgress = { ...currentProgress, stage: "discover-routes", message: "Discovering routes and navigation graph", percentage: 12 };
		const routeGraph = await discoverRouteGraphActivity({ projectDir, framework });
		if (routeGraph.routes.length === 0) {
			throw new Error("No routes found in project. Check framework detection and route conventions.");
		}
		console.log(`[WORKFLOW] Route graph: ${routeGraph.routes.length} routes, ${routeGraph.navigationGraph.length} edges`);

		// Phase 2: Identify flows from graph
		currentProgress = { ...currentProgress, stage: "identify-flows", message: "Identifying flows from route graph", percentage: 20 };
		const identifiedFlows = await identifyFlowsFromGraphActivity({
			routeGraph,
			framework,
			anthropicApiKey: llmApiKey,
			useOpenRouter,
		});

		if (identifiedFlows.length === 0) {
			throw new Error("No flows identified from route graph.");
		}

		// Phase 3: Assign personas to flows
		currentProgress = { ...currentProgress, stage: "assign-personas", message: "Assigning personas to flows", percentage: 35 };
		let personasWithFlows: Array<{ name: string; description: string; behaviors: string[]; flowNames: string[] }>;
		if (useCustomPersonas) {
			const loaded = await loadPersonasFromSupabaseActivity({
				projectId,
				source: "user_configured",
				supabaseUrl,
				supabaseServiceRoleKey,
			});
			personasWithFlows = loaded.personas.map((p: { name: string; description: string | null; behaviors: unknown }) => ({
				name: p.name,
				description: p.description ?? "",
				behaviors: Array.isArray((p.behaviors as { behaviors?: string[] })?.behaviors) ? (p.behaviors as { behaviors: string[] }).behaviors : [],
				flowNames: [], // Custom personas: we still need flow assignment; run LLM and match by name
			}));
			// Run assignment to get flowNames, then match to loaded personas by name
			const assigned = await assignPersonasToFlowsActivity({
				identifiedFlows,
				framework,
				anthropicApiKey: llmApiKey,
				useOpenRouter,
			});
			for (const a of assigned) {
				const loadedPersona = personasWithFlows.find((p) => p.name.toLowerCase() === a.name.toLowerCase());
				if (loadedPersona) loadedPersona.flowNames = a.flowNames;
			}
		} else {
			personasWithFlows = await assignPersonasToFlowsActivity({
				identifiedFlows,
				framework,
				anthropicApiKey: llmApiKey,
				useOpenRouter,
			});
		}

		// Persist personas (unless useCustomPersonas — already in DB)
		const allPersonas = personasWithFlows.map((p) => ({ name: p.name, description: p.description, behaviors: p.behaviors }));
		let personaIds: UUID[];
		if (useCustomPersonas) {
			const loaded = await loadPersonasFromSupabaseActivity({
				projectId,
				source: "user_configured",
				supabaseUrl,
				supabaseServiceRoleKey,
			});
			personaIds = loaded.personas.map((p: { id: string }) => p.id);
		} else {
			currentProgress = { ...currentProgress, message: "Persisting personas", percentage: 45 };
			personaIds = await persistPersonasActivity({
				projectId,
				personas: allPersonas,
				supabaseUrl,
				supabaseServiceRoleKey,
			});
		}

		// Build flow records: each (persona, flowName) -> one flow with that personaId and identifiedFlow data
		const flowRecords: Array<{
			name: string;
			description: string;
			personaId: UUID;
			personaName: string;
			triggerConditions: string[];
			pages: string[];
			connectedFlowIds: string[];
		}> = [];
		const nameToIdentifiedFlow = new Map(identifiedFlows.map((f) => [f.name, f]));
		for (let i = 0; i < personasWithFlows.length; i++) {
			const persona = personasWithFlows[i];
			const personaId = personaIds[i];
			if (!persona || !personaId) continue;
			for (const flowName of persona.flowNames) {
				const identified = nameToIdentifiedFlow.get(flowName);
				if (!identified) continue;
				flowRecords.push({
					name: identified.name,
					description: identified.description,
					personaId,
					personaName: persona.name,
					triggerConditions: [],
					pages: identified.pages,
					connectedFlowIds: identified.connectedFlowIds ?? [],
				});
			}
		}

		currentProgress = { ...currentProgress, message: "Persisting flows", percentage: 55 };
		const flowIds = await persistFlowsActivity({
			projectId,
			flows: flowRecords.map((f) => ({
				name: f.name,
				personaName: f.personaName,
				description: f.description,
				triggerConditions: f.triggerConditions,
				personaId: f.personaId,
				pages: f.pages,
				connectedFlowIds: f.connectedFlowIds,
			})),
			supabaseUrl,
			supabaseServiceRoleKey,
		});
		const flowsWithMeta = flowRecords.map((r, idx) => ({ ...r, flowId: flowIds[idx], identified: nameToIdentifiedFlow.get(r.name)! }));

		// Phase 4: Extract initial steps per flow (flow-scoped)
		currentProgress = { ...currentProgress, stage: "extract-steps", message: "Extracting initial steps for flows", percentage: 60 };
		let totalSteps = 0;
		const pathByRoute = new Map(routeGraph.routes.map((r) => [r.path, r.filePath]));

		for (let i = 0; i < flowsWithMeta.length; i++) {
			const row = flowsWithMeta[i];
			if (!row) continue;
			const { flowId, name, description, identified } = row;
			if (!flowId) continue;
			const flowPageFilePaths = (identified.pages ?? []).map((p: string) => pathByRoute.get(p)).filter(Boolean) as string[];
			currentProgress = {
				...currentProgress,
				message: `Extracting steps for ${name} (${i + 1}/${flowsWithMeta.length})`,
				percentage: 60 + Math.floor((i / flowsWithMeta.length) * 35),
			};
			const steps = await extractStepsForFlowActivity({
				projectDir: projectDir!,
				flowId,
				flowName: name,
				flowDescription: description,
				framework,
				branch,
				anthropicApiKey: llmApiKey,
				useOpenRouter,
				flowPageFilePaths: flowPageFilePaths.length > 0 ? flowPageFilePaths : undefined,
			});
			const stepsCreated = await persistStepsActivity({
				flowId,
				steps,
				supabaseUrl,
				supabaseServiceRoleKey,
			});
			totalSteps += stepsCreated;
			currentProgress = { ...currentProgress, stepsExtracted: totalSteps };
		}

		currentProgress = { ...currentProgress, stage: "complete", message: "Bootstrap complete!", percentage: 100 };

		if (projectDir) {
			try {
				await cleanupRepositoryActivity({ projectDir });
			} catch (e) {
				console.error("[WORKFLOW] Cleanup failed:", e);
			}
		}

		return {
			projectId,
			personasExtracted: personaIds.length,
			flowsExtracted: flowIds.length,
			stepsExtracted: totalSteps,
			totalCommitsProcessed: 0,
		};
	} catch (error) {
		currentProgress = {
			...currentProgress,
			stage: "error",
			message: error instanceof Error ? error.message : "Unknown error",
			error: error instanceof Error ? error.message : String(error),
		};
		if (projectDir) {
			try {
				await cleanupRepositoryActivity({ projectDir });
			} catch (e) {
				console.error("[WORKFLOW] Cleanup after error failed:", e);
			}
		}
		throw error;
	}
}
