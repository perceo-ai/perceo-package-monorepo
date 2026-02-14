#!/usr/bin/env node

// Suppress DEP0169 (url.parse) deprecation from dependencies (e.g. Supabase/HTTP stack).
// Our code uses the WHATWG URL API; this warning comes from transitive deps until they update.
const originalEmit = process.emit.bind(process);
process.emit = function (event: string | symbol, ...args: unknown[]) {
	const warning = args[0];
	if (
		event === "warning" &&
		warning &&
		typeof warning === "object" &&
		"name" in warning &&
		(warning as { name: string }).name === "DeprecationWarning" &&
		"message" in warning &&
		typeof (warning as { message: string }).message === "string" &&
		((warning as { message: string }).message.includes("url.parse()") || (warning as { code?: string }).code === "DEP0169")
	) {
		return true; // suppress: do not call originalEmit, so default stderr write is skipped
	}
	return (originalEmit as (event: string | symbol, ...args: unknown[]) => unknown).apply(process, [event, ...args]);
} as typeof process.emit;

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { delCommand } from "./commands/del.js";
import { analyzeCommand } from "./commands/analyze.js";
import { keysCommand } from "./commands/keys.js";
import { ensurePublicEnvLoaded } from "./publicEnv.js";
import { getCliVersion } from "./publicEnv.js";

const program = new Command();

program.name("perceo").description("Intelligent regression testing through multi-agent simulation").version(getCliVersion());

program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(initCommand);
program.addCommand(delCommand);
program.addCommand(analyzeCommand);
program.addCommand(keysCommand);

async function main(): Promise<void> {
	await ensurePublicEnvLoaded();
	await program.parseAsync();
}

main().catch((err: unknown) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
