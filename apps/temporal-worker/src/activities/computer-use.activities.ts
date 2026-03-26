import { Context } from "@temporalio/activity";
import type { FlowManifest } from "@perceo/computer-use-agent";
import { PerceoDataClient, type UUID } from "@perceo/supabase";
import { createAnthropicComputerUseLlm } from "../lib/anthropic-computer-use-llm";
import { ensureGceInstanceRunning, resolveGceInstanceForSnapshot } from "../lib/gce-windows-runner";
import { logger } from "../logger";
import type { ValidateWorkflowStartInput } from "./auth.activities";

/** ESM-only package; load from CJS worker via dynamic import. */
const computerUseAgentModule = import("@perceo/computer-use-agent");

/**
 * Authorize computer-use workflow: project API key with `workflows:start` or `computer-use:run`.
 */
export async function validateComputerUseWorkflowStartActivity(input: ValidateWorkflowStartInput): Promise<void> {
	const client = new PerceoDataClient({
		supabaseUrl: input.supabaseUrl,
		supabaseKey: input.supabaseServiceRoleKey,
	});

	const result = await client.validateApiKey(input.apiKey);
	if (!result) {
		throw new Error("Invalid API key");
	}
	if (result.projectId !== input.projectId) {
		throw new Error(`API key does not belong to project ${input.projectId}`);
	}

	const allowed =
		result.scopes.includes("workflows:start") ||
		result.scopes.includes("computer-use:run");
	if (!allowed) {
		throw new Error("API key missing workflows:start or computer-use:run scope");
	}
}

export async function loadComputerUseManifestsActivity(input: {
	projectId: string;
	flowIds: string[];
	supabaseUrl: string;
	supabaseServiceRoleKey: string;
}): Promise<FlowManifest[]> {
	const { materializeFlowManifest } = await computerUseAgentModule;
	const client = new PerceoDataClient({
		supabaseUrl: input.supabaseUrl,
		supabaseKey: input.supabaseServiceRoleKey,
	});

	const out: FlowManifest[] = [];
	for (const flowId of input.flowIds) {
		const flow = await client.getFlow(flowId as UUID);
		if (!flow || flow.project_id !== input.projectId) {
			continue;
		}
		const cu = await client.getFlowComputerUse(flowId as UUID);
		if (!cu) {
			continue;
		}
		out.push(materializeFlowManifest(flow, cu));
	}

	return out;
}

/**
 * Ensure the Windows runner VM in GCP is running before RDP / bridge traffic.
 * Set PERCEO_GCE_SKIP=true to skip (local dev with a manual VM).
 */
export async function ensureGceWindowsVmForSnapshotActivity(input: { snapshotName: string }): Promise<void> {
	if (process.env.PERCEO_GCE_SKIP === "1" || process.env.PERCEO_GCE_SKIP === "true") {
		logger.info("Skipping GCE ensure (PERCEO_GCE_SKIP)", { snapshot: input.snapshotName });
		return;
	}

	const projectId = process.env.PERCEO_GCP_PROJECT_ID;
	const zone = process.env.PERCEO_GCE_ZONE;
	if (!projectId || !zone) {
		throw new Error("Set PERCEO_GCP_PROJECT_ID and PERCEO_GCE_ZONE, or PERCEO_GCE_SKIP=true");
	}

	const instanceName = resolveGceInstanceForSnapshot(input.snapshotName);
	logger.info("Ensuring GCE instance running", { instanceName, zone, projectId });
	await ensureGceInstanceRunning({ projectId, zone, instanceName });
}

export async function startComputerUseTestRunActivity(input: {
	projectId: string;
	flowId: string;
	supabaseUrl: string;
	supabaseServiceRoleKey: string;
	prNumber?: number;
	commitSha?: string;
	branchName?: string;
}): Promise<{ testRunId: string }> {
	const client = new PerceoDataClient({
		supabaseUrl: input.supabaseUrl,
		supabaseKey: input.supabaseServiceRoleKey,
	});

	const run = await client.createTestRun({
		project_id: input.projectId as UUID,
		flow_id: input.flowId as UUID,
		status: "running",
		triggered_by: input.prNumber != null ? "pr" : "manual",
		pr_number: input.prNumber ?? null,
		commit_sha: input.commitSha ?? null,
		branch_name: input.branchName ?? null,
		agent_type: "computer-use",
		started_at: new Date().toISOString(),
	});

	return { testRunId: run.id };
}

export async function executeComputerUseFlowActivity(input: {
	manifest: FlowManifest;
	testRunId: string;
	projectId: string;
	supabaseUrl: string;
	supabaseServiceRoleKey: string;
}): Promise<{ success: boolean; reason: string }> {
	const { runAgentLoop, HttpWindowsVmBridge, WindowsVMAdapter } = await computerUseAgentModule;

	const bridgeUrl = process.env.PERCEO_VM_BRIDGE_URL;
	if (!bridgeUrl) {
		throw new Error("PERCEO_VM_BRIDGE_URL is required (HTTP sidecar next to the Windows desktop)");
	}

	const anthropicKey = process.env.PERCEO_ANTHROPIC_API_KEY;
	if (!anthropicKey) {
		throw new Error("PERCEO_ANTHROPIC_API_KEY is required for the vision agent");
	}

	const client = new PerceoDataClient({
		supabaseUrl: input.supabaseUrl,
		supabaseKey: input.supabaseServiceRoleKey,
	});

	const started = Date.now();
	const maxSteps = parseInt(process.env.PERCEO_COMPUTER_USE_MAX_STEPS ?? "50", 10);
	const vmId = process.env.PERCEO_VM_ID ?? "gce-windows";

	if (input.manifest.vmType !== "windows") {
		throw new Error(`Computer-use on ${input.manifest.vmType} is not wired in this worker yet; use vm_type windows on GCP.`);
	}

	const adapter = new WindowsVMAdapter(new HttpWindowsVmBridge(bridgeUrl));
	const llm = createAnthropicComputerUseLlm(anthropicKey);

	try {
		const result = await runAgentLoop(
			{
				runId: input.testRunId,
				flowId: input.manifest.flowId,
				goal: input.manifest.goal,
				successCriteria: input.manifest.successCriteria,
				stepIndex: 0,
				maxSteps,
			},
			{
				adapter,
				llm,
				onAfterStep: (step) => Context.current().heartbeat({ step }),
				uploadScreenshot: async (screenshot, runId, stepIndex) =>
					client.uploadComputerUseScreenshot({
						projectId: input.projectId as UUID,
						runId: runId as UUID,
						stepIndex,
						jpeg: screenshot,
					}),
				telemetry: {
					async push(payload) {
						const path = payload.screenshotUrl;
						await client.insertTelemetryEvent({
							test_run_id: input.testRunId as UUID,
							flow_id: input.manifest.flowId as UUID,
							vm_id: vmId,
							step_index: payload.stepIndex,
							action_type: payload.action.type,
							success: payload.action.type === "done" ? payload.action.success : null,
							screenshot_url: path ?? null,
							coordinator_event: null,
							payload: { action: payload.action as unknown as Record<string, unknown> },
						});
						await client.appendTestRunComputerUseStep(input.testRunId as UUID, {
							screenshotStoragePath: path,
							log: {
								stepIndex: payload.stepIndex,
								action: payload.action,
								at: payload.timestamp,
							},
						});
					},
				},
			},
		);

		await client.updateTestRun(input.testRunId as UUID, {
			status: result.success ? "passed" : "failed",
			completed_at: new Date().toISOString(),
			duration_ms: Date.now() - started,
			error_message: result.success ? null : result.reason,
		});

		return result;
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		await client.updateTestRun(input.testRunId as UUID, {
			status: "error",
			completed_at: new Date().toISOString(),
			duration_ms: Date.now() - started,
			error_message: msg,
		});
		throw e;
	}
}
