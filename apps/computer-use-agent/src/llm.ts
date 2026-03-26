import type { AgentAction } from "./agent-action.js";

export type ComputerUseLlmCallInput = {
	systemPrompt: string;
	screenshot: Buffer;
	goal: string;
	successCriteria: string;
	workingMemory: string[];
	stepIndex: number;
};

/**
 * Vision LLM client (e.g. Claude Sonnet). Implementations live in the worker / runtime host.
 */
export type ComputerUseLlmClient = {
	call(input: ComputerUseLlmCallInput): Promise<AgentAction>;
};
