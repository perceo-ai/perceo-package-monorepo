import { PerceoDataClient } from "@perceo/supabase";
import type { PersonaInsert, FlowInsert, StepInsert, UUID } from "@perceo/supabase";
import { Persona, Flow, Step } from "../utils/claude";
import { logger } from "../logger";

export interface PersistPersonasInput {
	projectId: string;
	personas: Persona[];
	supabaseUrl: string;
	supabaseServiceRoleKey: string;
}

export interface PersistFlowsInput {
	projectId: string;
	flows: Array<
		Flow & {
			personaId: UUID;
			/** Route paths for this flow (1-2 pages). Stored in graph_data. */
			pages?: string[];
			/** Flow names this flow connects to. Stored in graph_data. */
			connectedFlowIds?: string[];
		}
	>;
	supabaseUrl: string;
	supabaseServiceRoleKey: string;
}

export interface PersistStepsInput {
	flowId: string;
	steps: Step[];
	supabaseUrl: string;
	supabaseServiceRoleKey: string;
}

/**
 * Persist personas to Supabase in batch
 */
export async function persistPersonasActivity(input: PersistPersonasInput): Promise<UUID[]> {
	const { projectId, personas, supabaseUrl, supabaseServiceRoleKey } = input;
	const log = logger.withActivity("persistPersonas");

	log.info("Persisting personas", { projectId, count: personas.length });

	// Create service role client (bypasses RLS)
	const client = new PerceoDataClient({
		supabaseUrl,
		supabaseKey: supabaseServiceRoleKey,
		projectId,
	});

	const personaIds: UUID[] = [];

	// Insert personas one by one (could batch but this ensures we get IDs)
	for (const persona of personas) {
		const personaInsert: PersonaInsert = {
			project_id: projectId,
			name: persona.name,
			description: persona.description || null,
			source: "auto_generated", // Add missing required property
			behaviors: {
				behaviors: persona.behaviors,
			},
		};

		try {
			const created = await client.createPersona(personaInsert);
			personaIds.push(created.id);
			log.info("Created persona", { projectId, personaName: persona.name, personaId: created.id });
		} catch (error) {
			log.error("Failed to create persona", {
				projectId,
				personaName: persona.name,
				error: error instanceof Error ? error.message : String(error),
			});
			// Continue with other personas
		}
	}

	log.info("Personas persist complete", {
		projectId,
		persisted: personaIds.length,
		total: personas.length,
	});

	return personaIds;
}

/**
 * Persist flows to Supabase in batch
 */
export async function persistFlowsActivity(input: PersistFlowsInput): Promise<UUID[]> {
	const { projectId, flows, supabaseUrl, supabaseServiceRoleKey } = input;
	const log = logger.withActivity("persistFlows");

	log.info("Persisting flows", { projectId, count: flows.length });

	// Create service role client (bypasses RLS)
	const client = new PerceoDataClient({
		supabaseUrl,
		supabaseKey: supabaseServiceRoleKey,
		projectId,
	});

	const flowIds: UUID[] = [];

	// Insert flows one by one
	for (const flow of flows) {
		const flowInsert: FlowInsert = {
			project_id: projectId,
			persona_id: flow.personaId || null,
			name: flow.name,
			description: flow.description || null,
			priority: "medium", // Default priority
			entry_point: null, // Will be determined later
			graph_data: {
				triggerConditions: flow.triggerConditions ?? [],
				...(flow.pages && { pages: flow.pages }),
				...(flow.connectedFlowIds && { connectedFlowIds: flow.connectedFlowIds }),
			},
			coverage_score: null,
			is_active: true,
		};

		try {
			const created = await client.createFlow(flowInsert);
			flowIds.push(created.id);
			log.info("Created flow", { projectId, flowName: flow.name, flowId: created.id });
		} catch (error) {
			log.error("Failed to create flow", {
				projectId,
				flowName: flow.name,
				error: error instanceof Error ? error.message : String(error),
			});
			// Continue with other flows
		}
	}

	log.info("Flows persist complete", {
		projectId,
		persisted: flowIds.length,
		total: flows.length,
	});

	return flowIds;
}

/**
 * Persist steps for a flow to Supabase in batch
 */
export async function persistStepsActivity(input: PersistStepsInput): Promise<number> {
	const { flowId, steps, supabaseUrl, supabaseServiceRoleKey } = input;
	const log = logger.withActivity("persistSteps");

	log.info("Persisting steps", { flowId, count: steps.length });

	if (steps.length === 0) {
		log.info("No steps to persist", { flowId });
		return 0;
	}

	// Create service role client (bypasses RLS)
	const client = new PerceoDataClient({
		supabaseUrl,
		supabaseKey: supabaseServiceRoleKey,
	});

	// Convert Claude steps to Supabase format
	const stepInserts: StepInsert[] = steps.map((step, index) => ({
		flow_id: flowId,
		sequence_order: step.stepNumber || index + 1,
		name: step.action,
		actions: [
			{
				type: "click", // Default, should be parsed from action text
				target: step.selectors?.[0] || undefined,
			},
		],
		expected_state: {
			text: { description: step.expectedState },
			visible: step.selectors,
		},
		timeout_ms: 30000, // Default 30s
		retry_count: 3, // Default 3 retries
		next_step_id: null, // Will be set up later if needed
		branch_config: null,
	}));

	try {
		const created = await client.createSteps(stepInserts);
		log.info("Steps created", { flowId, count: created.length });
		return created.length;
	} catch (error) {
		log.error("Failed to create steps", {
			flowId,
			error: error instanceof Error ? error.message : String(error),
		});
		return 0;
	}
}
