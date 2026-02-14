import { PerceoDataClient } from "@perceo/supabase";
import type { PersonaInsert, FlowInsert, StepInsert, UUID } from "@perceo/supabase";
import { Persona, Flow, Step } from "../utils/claude";

export interface PersistPersonasInput {
	projectId: string;
	personas: Persona[];
	supabaseUrl: string;
	supabaseServiceRoleKey: string;
}

export interface PersistFlowsInput {
	projectId: string;
	flows: Array<Flow & { personaId: UUID }>;
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

	console.log(`Persisting ${personas.length} personas for project ${projectId}`);

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
			console.log(`Created persona: ${persona.name} (${created.id})`);
		} catch (error) {
			console.error(`Failed to create persona ${persona.name}:`, error);
			// Continue with other personas
		}
	}

	console.log(`Successfully persisted ${personaIds.length}/${personas.length} personas`);

	return personaIds;
}

/**
 * Persist flows to Supabase in batch
 */
export async function persistFlowsActivity(input: PersistFlowsInput): Promise<UUID[]> {
	const { projectId, flows, supabaseUrl, supabaseServiceRoleKey } = input;

	console.log(`Persisting ${flows.length} flows for project ${projectId}`);

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
				triggerConditions: flow.triggerConditions,
			},
			coverage_score: null,
			is_active: true,
		};

		try {
			const created = await client.createFlow(flowInsert);
			flowIds.push(created.id);
			console.log(`Created flow: ${flow.name} (${created.id})`);
		} catch (error) {
			console.error(`Failed to create flow ${flow.name}:`, error);
			// Continue with other flows
		}
	}

	console.log(`Successfully persisted ${flowIds.length}/${flows.length} flows`);

	return flowIds;
}

/**
 * Persist steps for a flow to Supabase in batch
 */
export async function persistStepsActivity(input: PersistStepsInput): Promise<number> {
	const { flowId, steps, supabaseUrl, supabaseServiceRoleKey } = input;

	console.log(`Persisting ${steps.length} steps for flow ${flowId}`);

	if (steps.length === 0) {
		console.log("No steps to persist");
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
		console.log(`Created ${created.length} steps for flow ${flowId}`);
		return created.length;
	} catch (error) {
		console.error(`Failed to create steps for flow ${flowId}:`, error);
		return 0;
	}
}
