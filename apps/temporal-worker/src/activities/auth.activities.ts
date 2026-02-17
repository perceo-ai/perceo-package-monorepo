import { PerceoDataClient } from "@perceo/supabase";
import { logger } from "../logger";

export interface ValidateWorkflowStartInput {
	apiKey: string;
	projectId: string;
	supabaseUrl: string;
	supabaseServiceRoleKey: string;
}

/**
 * Validate that the workflow start is authorized
 *
 * Checks:
 * 1. API key is valid
 * 2. API key has 'workflows:start' scope
 * 3. API key belongs to the specified project
 *
 * Throws an error if validation fails, terminating the workflow immediately.
 */
export async function validateWorkflowStartActivity(input: ValidateWorkflowStartInput): Promise<void> {
	const { apiKey, projectId, supabaseUrl, supabaseServiceRoleKey } = input;
	const log = logger.withActivity("validateWorkflowStart", undefined);

	log.info("Validating workflow authorization", {
		projectId,
		apiKeyPrefix: apiKey.substring(0, 12),
		supabaseUrl,
	});

	// Create service role client (bypasses RLS)
	const client = new PerceoDataClient({
		supabaseUrl,
		supabaseKey: supabaseServiceRoleKey,
	});

	const result = await client.validateApiKey(apiKey);

	if (!result) {
		log.error("API key not found in database", {
			projectId,
			apiKeyPrefix: apiKey.substring(0, 12),
		});
		throw new Error("Invalid API key");
	}

	log.info("API key found; checking project and scopes", {
		projectId,
		keyProjectId: result.projectId,
		scopes: result.scopes,
	});

	if (result.projectId !== projectId) {
		log.error("Project ID mismatch", {
			expected: projectId,
			keyBelongsTo: result.projectId,
		});
		throw new Error(`API key does not belong to project ${projectId} (belongs to ${result.projectId})`);
	}

	if (!result.scopes.includes("workflows:start")) {
		log.error("Missing workflows:start scope", {
			projectId,
			scopes: result.scopes,
		});
		throw new Error("API key does not have workflows:start scope. Required scopes: workflows:start");
	}

	log.info("Workflow start authorized", { projectId });
}

export interface GetProjectSecretInput {
	projectId: string;
	keyName: string;
	supabaseUrl: string;
	supabaseServiceRoleKey: string;
}

/**
 * Fetch a project secret from Supabase
 *
 * Uses service role to access encrypted secrets.
 * Returns the secret value or throws if not found.
 */
export async function getProjectSecretActivity(input: GetProjectSecretInput): Promise<string> {
	const { projectId, keyName, supabaseUrl, supabaseServiceRoleKey } = input;

	// Create service role client
	const client = new PerceoDataClient({
		supabaseUrl,
		supabaseKey: supabaseServiceRoleKey,
	});

	// Call the get_project_secret database function
	const { data, error } = await client.getClient().rpc("get_project_secret", {
		p_project_id: projectId,
		p_key_name: keyName,
	});

	if (error) {
		logger.error("Failed to fetch project secret", {
			activity: "getProjectSecret",
			projectId,
			keyName,
			error: error.message,
		});
		throw new Error(`Failed to fetch project secret '${keyName}': ${error.message}`);
	}

	if (!data) {
		logger.warn("Project secret not found", { projectId, keyName });
		throw new Error(`Project secret '${keyName}' not found for project ${projectId}`);
	}

	return data;
}
