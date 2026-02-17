import { PerceoDataClient } from "@perceo/supabase";
import { logger } from "../logger";

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
	const log = logger.withActivity("loadPersonasFromSupabase");

	log.info("Loading personas from Supabase", { projectId, source, supabaseUrl });

	const client = new PerceoDataClient({
		supabaseUrl,
		supabaseKey: supabaseServiceRoleKey,
		projectId,
	});

	const personas = await client.getPersonasBySource(source, projectId);

	log.info("Personas loaded", {
		projectId,
		source,
		count: personas.length,
		personaNames: personas.map((p) => p.name),
	});

	return {
		personas,
		count: personas.length,
	};
}
