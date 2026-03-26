import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function templateDir(): string {
	return dirname(fileURLToPath(import.meta.url));
}

export function loadAgentSystemPromptTemplate(): string {
	return readFileSync(join(templateDir(), "prompts", "agent-system.md"), "utf8");
}

export function buildAgentSystemPrompt(params: {
	goal: string;
	successCriteria: string;
	workingMemory: string;
}): string {
	return loadAgentSystemPromptTemplate()
		.replace(/\{\{goal\}\}/g, params.goal)
		.replace(/\{\{successCriteria\}\}/g, params.successCriteria)
		.replace(/\{\{workingMemory\}\}/g, params.workingMemory);
}
