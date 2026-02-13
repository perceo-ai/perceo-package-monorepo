import { Command } from "commander";
import chalk from "chalk";
import path from "node:path";
import type { AuthScope } from "../auth.js";
import { clearStoredAuth, getStoredAuth } from "../auth.js";

type LogoutOptions = {
	scope: "project" | "global";
	dir: string;
};

export const logoutCommand = new Command("logout")
	.description("Log out from Perceo (remove stored auth for the given scope)")
	.option("-s, --scope <scope>", "Which login to remove: 'project' or 'global'", "project")
	.option("-d, --dir <directory>", "Project directory (for project scope)", process.cwd())
	.action(async (options: LogoutOptions) => {
		const scope = (options.scope?.toLowerCase() === "global" ? "global" : "project") as AuthScope;
		const projectDir = path.resolve(options.dir || process.cwd());

		const existing = await getStoredAuth(scope, scope === "project" ? projectDir : undefined);
		if (!existing?.access_token) {
			console.log(chalk.yellow(`Not logged in (${scope} scope). Nothing to do.`));
			return;
		}

		await clearStoredAuth(scope, scope === "project" ? projectDir : undefined);
		console.log(chalk.green(`Logged out successfully (${scope} scope).`));
	});
