import type { AgentAction } from "./agent-action.js";

export type TelemetryStepPayload = {
	runId: string;
	flowId: string;
	stepIndex: number;
	action: AgentAction;
	screenshotUrl?: string;
	timestamp: number;
};

export type TelemetrySink = {
	push(payload: TelemetryStepPayload): Promise<void>;
};

export const noopTelemetry: TelemetrySink = {
	async push() {
		/* no-op */
	},
};
