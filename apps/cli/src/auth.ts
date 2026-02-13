import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAnonKey } from "@perceo/supabase";

export type AuthScope = "project" | "global";

export type StoredAuth = {
	access_token: string;
	refresh_token: string;
	expires_at?: number;
	scope: AuthScope;
	supabaseUrl: string;
};

const AUTH_FILE = "auth.json";

/**
 * Resolve the directory used for global Perceo config (auth, etc.).
 * Prefers XDG_CONFIG_HOME/perceo, then ~/.perceo.
 */
function getGlobalConfigDir(): string {
	const xdg = process.env.XDG_CONFIG_HOME;
	if (xdg) {
		return path.join(xdg, "perceo");
	}
	return path.join(os.homedir(), ".perceo");
}

/**
 * Path to the auth file for the given scope.
 * - project: <projectDir>/.perceo/auth.json (projectDir required)
 * - global: ~/.perceo/auth.json or XDG_CONFIG_HOME/perceo/auth.json
 */
export function getAuthPath(scope: AuthScope, projectDir?: string): string {
	if (scope === "project") {
		if (!projectDir) {
			throw new Error("projectDir is required for project-scoped auth");
		}
		return path.join(path.resolve(projectDir), ".perceo", AUTH_FILE);
	}
	return path.join(getGlobalConfigDir(), AUTH_FILE);
}

async function fileExists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

/**
 * Read stored auth for the given scope (and optional projectDir for project scope).
 * Returns null if file is missing or invalid.
 */
export async function getStoredAuth(scope: AuthScope, projectDir?: string): Promise<StoredAuth | null> {
	const authPath = getAuthPath(scope, projectDir);
	if (!(await fileExists(authPath))) return null;
	try {
		const raw = await fs.readFile(authPath, "utf8");
		const data = JSON.parse(raw) as StoredAuth;
		if (!data.access_token || !data.refresh_token || data.scope !== scope) return null;
		return data;
	} catch {
		return null;
	}
}

/**
 * Write auth to the store. Creates parent directory if needed.
 */
export async function setStoredAuth(auth: StoredAuth, projectDir?: string): Promise<void> {
	const scope = auth.scope;
	const authPath = getAuthPath(scope, projectDir);
	const dir = path.dirname(authPath);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(authPath, JSON.stringify(auth, null, 2) + "\n", "utf8");
}

/**
 * Remove stored auth for the given scope.
 */
export async function clearStoredAuth(scope: AuthScope, projectDir?: string): Promise<void> {
	const authPath = getAuthPath(scope, projectDir);
	if (await fileExists(authPath)) {
		await fs.unlink(authPath);
	}
}

/**
 * Check if the user is logged in for the given context.
 * Resolution order: project-scoped auth in projectDir, then global auth.
 * projectDir defaults to process.cwd().
 */
export async function isLoggedIn(projectDir: string = process.cwd()): Promise<boolean> {
	const projectAuth = await getStoredAuth("project", projectDir);
	if (projectAuth?.access_token) return true;
	const globalAuth = await getStoredAuth("global");
	return !!globalAuth?.access_token;
}

/**
 * Get the effective stored auth for a context: project first, then global.
 * Returns null if not logged in.
 */
export async function getEffectiveAuth(projectDir: string = process.cwd()): Promise<StoredAuth | null> {
	const projectAuth = await getStoredAuth("project", projectDir);
	if (projectAuth?.access_token) return projectAuth;
	return getStoredAuth("global");
}

/**
 * Create an authenticated Supabase client using stored auth credentials.
 * Returns null if user is not logged in.
 * 
 * This client automatically uses the embedded Perceo Cloud credentials
 * and the user's authentication tokens from local storage.
 */
export async function getAuthenticatedSupabaseClient(projectDir?: string): Promise<SupabaseClient | null> {
	const auth = await getEffectiveAuth(projectDir);
	if (!auth) return null;

	const supabase = createClient(auth.supabaseUrl, getSupabaseAnonKey(), {
		auth: {
			autoRefreshToken: true,
			persistSession: false,
		},
	});

	// Set the user's session
	const { error } = await supabase.auth.setSession({
		access_token: auth.access_token,
		refresh_token: auth.refresh_token,
	});

	if (error) {
		console.error("Failed to restore auth session:", error.message);
		return null;
	}

	return supabase;
}
