/**
 * Project access control: ensure the current user has access to the project
 * before performing operations. Uses Supabase RLS and project_members.
 */

import path from "node:path";
import chalk from "chalk";
import { getEffectiveAuth } from "./auth.js";
import { PerceoDataClient, getSupabaseUrl, getSupabaseAnonKey } from "@perceo/supabase";
import { loadConfig } from "./config.js";
import type { ProjectRole } from "@perceo/supabase";

const ADMIN_ROLES: ProjectRole[] = ["owner", "admin"];

export type EnsureProjectAccessOptions = {
	projectDir?: string;
	/** If true, require admin or owner role (e.g. for delete, revoke, manage members) */
	requireAdmin?: boolean;
};

export type EnsureProjectAccessResult = {
	client: PerceoDataClient;
	projectId: string;
	projectName: string;
	role: ProjectRole;
	config: Record<string, unknown>;
};

/**
 * Load config, authenticate, and ensure the current user is a member of the project.
 * Exits with a clear message if not logged in, no project, or no access.
 * Use this at the start of commands that operate on the current project (del, keys, analyze).
 */
export async function ensureProjectAccess(options: EnsureProjectAccessOptions = {}): Promise<EnsureProjectAccessResult> {
	const projectDir = path.resolve(options.projectDir ?? process.cwd());
	const requireAdmin = options.requireAdmin ?? false;

	const auth = await getEffectiveAuth(projectDir);
	if (!auth?.access_token) {
		console.error(chalk.red("You must log in first. Run ") + chalk.cyan("perceo login"));
		process.exit(1);
	}

	const config = (await loadConfig({ projectDir })) as Record<string, unknown>;
	const projectId = (config?.project as { id?: string })?.id;
	const projectName = (config?.project as { name?: string })?.name ?? path.basename(projectDir);

	if (!projectId) {
		console.error(chalk.red("No project linked. Run ") + chalk.cyan("perceo init") + chalk.red(" in this directory first."));
		process.exit(1);
	}

	const supabaseUrl = auth.supabaseUrl;
	const supabaseKey = getSupabaseAnonKey();
	const client = await PerceoDataClient.fromUserSession({
		supabaseUrl,
		supabaseKey,
		accessToken: auth.access_token,
		refreshToken: auth.refresh_token,
		projectId,
	});

	const role = await client.getProjectMemberRole(projectId);
	if (!role) {
		console.error(chalk.red("You don't have access to this project."));
		console.error(chalk.gray("Only users added to the project can view or change it. Ask a project owner or admin to add you."));
		process.exit(1);
	}

	if (requireAdmin && !ADMIN_ROLES.includes(role)) {
		console.error(chalk.red("This action requires project owner or admin role."));
		console.error(chalk.gray(`Your role: ${role}. Ask a project owner or admin to perform this action or change your role.`));
		process.exit(1);
	}

	return { client, projectId, projectName, role, config };
}

/**
 * Check if the current user has access to the given project (by id).
 * Use when you already have a user-session client and project id (e.g. in init when reusing an existing project).
 * Returns the user's role or null if not a member.
 */
export async function checkProjectAccess(client: PerceoDataClient, projectId: string, options: { requireAdmin?: boolean } = {}): Promise<ProjectRole | null> {
	const role = await client.getProjectMemberRole(projectId);
	if (!role) return null;
	if (options.requireAdmin && !ADMIN_ROLES.includes(role)) return null;
	return role;
}
