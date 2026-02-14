import { PerceoDataClient } from "@perceo/supabase";

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

	console.log(`Validating workflow authorization for project ${projectId}`);
	console.log(`  API Key prefix: ${apiKey.substring(0, 12)}...`);
	console.log(`  Supabase URL: ${supabaseUrl}`);

	// Create service role client (bypasses RLS)
	const client = new PerceoDataClient({
		supabaseUrl,
		supabaseKey: supabaseServiceRoleKey,
	});

	// Validate API key
	console.log(`  Looking up API key in project_api_keys table...`);
	const result = await client.validateApiKey(apiKey);

	if (!result) {
		console.error(`  ✗ API key not found in database`);
		console.error(`  Expected format: prc_<base64url_string>`);
		console.error(`  Provided key starts with: ${apiKey.substring(0, 12)}`);
		throw new Error("Invalid API key");
	}

	console.log(`  ✓ API key found in database`);
	console.log(`  Key belongs to project: ${result.projectId}`);
	console.log(`  Key scopes: ${result.scopes.join(", ")}`);

	// Check project match
	if (result.projectId !== projectId) {
		console.error(`  ✗ Project ID mismatch`);
		console.error(`  Expected: ${projectId}`);
		console.error(`  Key belongs to: ${result.projectId}`);
		throw new Error(`API key does not belong to project ${projectId} (belongs to ${result.projectId})`);
	}

	console.log(`  ✓ Project ID matches`);

	// Check for workflows:start scope
	if (!result.scopes.includes("workflows:start")) {
		console.error(`  ✗ Missing required scope: workflows:start`);
		console.error(`  Key has scopes: ${result.scopes.join(", ")}`);
		throw new Error("API key does not have workflows:start scope. Required scopes: workflows:start");
	}

	console.log(`  ✓ workflows:start scope present`);

	// Validation successful
	console.log(`✓ Workflow start authorized for project ${projectId}`);
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
		throw new Error(`Failed to fetch project secret '${keyName}': ${error.message}`);
	}

	if (!data) {
		throw new Error(`Project secret '${keyName}' not found for project ${projectId}`);
	}

	return data;
}
