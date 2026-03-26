export type { FlowManifest, AppSource, VmType, FlowManifestPriority, CacheStrategy } from "./flow-manifest.js";
export { resolveProvisionSnapshot } from "./flow-manifest.js";

export { materializeFlowManifest } from "./materialize-manifest.js";

export type {
	AgentAction,
	AgentClickAction,
	AgentTypeAction,
	AgentScrollAction,
	AgentInjectAudioAction,
	AgentShortcutAction,
	AgentDoneAction,
} from "./agent-action.js";
export { isTerminalAction } from "./agent-action.js";

export type { VMAdapter } from "./vma-adapter.js";
export { executeAgentAction } from "./vma-adapter.js";

export { MockVMAdapter } from "./adapters/mock-adapter.js";
export { WindowsVMAdapter, type WindowsVmBridge } from "./adapters/windows-adapter.js";
export { HttpWindowsVmBridge } from "./adapters/http-windows-bridge.js";

export { loadAgentSystemPromptTemplate, buildAgentSystemPrompt } from "./prompt.js";

export type { ComputerUseLlmClient, ComputerUseLlmCallInput } from "./llm.js";

export type { TelemetrySink, TelemetryStepPayload } from "./telemetry.js";
export { noopTelemetry } from "./telemetry.js";

export type { AgentTask, AgentRunResult, RunAgentLoopOptions } from "./agent/run-agent-loop.js";
export { runAgentLoop } from "./agent/run-agent-loop.js";

export {
	repoRefreshActivity,
	type VmHandle,
	type VmOrchestration,
	type TemporalSecrets,
	type RepoRefreshDeps,
} from "./coordinator/repo-refresh.js";
