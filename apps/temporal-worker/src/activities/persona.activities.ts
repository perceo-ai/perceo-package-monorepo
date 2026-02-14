import { PerceoDataClient } from "@perceo/supabase";

export interface LoadPersonasFromSupabaseInput {
	projectId: string;
	source: "user_configured" | "auto_generated";
	supabaseUrl: string;
	supabaseServiceRoleKey: string;
}

export interface LoadPersonasFromSupabaseResult {
	personas: any[];
	count: number;
}

/**
 * Load personas from Supabase by source type
 */
export async function loadPersonasFromSupabaseActivity(input: LoadPersonasFromSupabaseInput): Promise<LoadPersonasFromSupabaseResult> {
	const { projectId, source, supabaseUrl, supabaseServiceRoleKey } = input;

	console.log(`[PERSONA] Loading ${source} personas for project ${projectId}`);
	console.log(`[PERSONA] Supabase URL: ${supabaseUrl}`);

	try {
		// Create Supabase client with service role key
		const client = new PerceoDataClient({
			supabaseUrl,
			supabaseKey: supabaseServiceRoleKey,
			projectId,
		});

		// Load personas by source
		const personas = await client.getPersonasBySource(source, projectId);

		console.log(`[PERSONA] ✓ Loaded ${personas.length} ${source} personas`);

		if (personas.length > 0) {
			console.log(`[PERSONA] Persona names: ${personas.map((p) => p.name).join(", ")}`);
		}

		return {
			personas,
			count: personas.length,
		};
	} catch (error) {
		console.error(`[PERSONA] ✗ Failed to load ${source} personas:`, error);
		throw new Error(`Failed to load ${source} personas from Supabase: ${error instanceof Error ? error.message : String(error)}`);
	}
}
