import { isTerminalAction } from "../agent-action.js";
import type { AgentAction } from "../agent-action.js";
import { buildAgentSystemPrompt } from "../prompt.js";
import type { ComputerUseLlmClient } from "../llm.js";
import type { TelemetrySink } from "../telemetry.js";
import { noopTelemetry } from "../telemetry.js";
import { executeAgentAction, type VMAdapter } from "../vma-adapter.js";

export type AgentTask = {
	runId: string;
	flowId: string;
	goal: string;
	successCriteria: string;
	stepIndex: number;
	maxSteps: number;
};

export type AgentRunResult =
	| { success: true; reason: string }
	| { success: false; reason: string };

async function uploadScreenshotPlaceholder(
	_screenshot: Buffer,
	_runId: string,
	_stepIndex: number,
): Promise<string | undefined> {
	return undefined;
}

export type RunAgentLoopOptions = {
	adapter: VMAdapter;
	llm: ComputerUseLlmClient;
	telemetry?: TelemetrySink;
	uploadScreenshot?: typeof uploadScreenshotPlaceholder;
	/** Optional hook after each step (e.g. Temporal activity heartbeat). */
	onAfterStep?: (stepIndex: number) => void;
	abortSignal?: AbortSignal;
};

/**
 * Vision → action → telemetry loop for one Temporal activity (PRD Week 1).
 */
export async function runAgentLoop(
	task: AgentTask,
	options: RunAgentLoopOptions,
): Promise<AgentRunResult> {
	const telemetry = options.telemetry ?? noopTelemetry;
	const upload = options.uploadScreenshot ?? uploadScreenshotPlaceholder;

	const workingMemory: string[] = [];
	let stepIndex = task.stepIndex;

	while (true) {
		if (options.abortSignal?.aborted) {
			return { success: false, reason: "cancelled" };
		}
		const screenshot = await options.adapter.getScreenshot();
		const screenshotUrl = await upload(screenshot, task.runId, stepIndex);

		const workingMemoryText = workingMemory.slice(-10).join("\n") || "(none yet)";

		const systemPrompt = buildAgentSystemPrompt({
			goal: task.goal,
			successCriteria: task.successCriteria,
			workingMemory: workingMemoryText,
		});

		let action: AgentAction = await options.llm.call({
			systemPrompt,
			screenshot,
			goal: task.goal,
			successCriteria: task.successCriteria,
			workingMemory: workingMemory.slice(-10),
			stepIndex,
		});

		try {
			await executeAgentAction(options.adapter, action);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			action = { type: "done", success: false, reason: msg };
		}

		await telemetry.push({
			runId: task.runId,
			flowId: task.flowId,
			stepIndex,
			action,
			screenshotUrl,
			timestamp: Date.now(),
		});

		options.onAfterStep?.(stepIndex);

		const summary = "summary" in action && typeof action.summary === "string" ? action.summary : "";
		if (summary) workingMemory.push(summary);

		if (isTerminalAction(action)) {
			return { success: action.success, reason: action.reason };
		}

		stepIndex += 1;
		if (stepIndex > task.maxSteps) {
			return { success: false, reason: "max steps exceeded" };
		}
	}
}
