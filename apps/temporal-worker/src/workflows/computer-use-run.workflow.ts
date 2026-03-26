import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities";
import type { FlowManifest } from "@perceo/computer-use-agent";

const {
	validateComputerUseWorkflowStartActivity,
	loadComputerUseManifestsActivity,
	ensureGceWindowsVmForSnapshotActivity,
	startComputerUseTestRunActivity,
	executeComputerUseFlowActivity,
} = proxyActivities<typeof activities>({
	startToCloseTimeout: "2 hours",
	heartbeatTimeout: "3 minutes",
	retry: {
		initialInterval: "5s",
		maximumInterval: "120s",
		backoffCoefficient: 2,
		maximumAttempts: 2,
	},
});

export interface ComputerUseRunWorkflowInput {
	projectId: string;
	workflowApiKey: string;
	supabaseUrl: string;
	supabaseServiceRoleKey: string;
	flowIds: string[];
	prNumber?: number;
	commitSha?: string;
	branchName?: string;
}

export interface ComputerUseRunFlowResult {
	flowId: string;
	testRunId: string;
	success: boolean;
	reason: string;
}

function provisionSnapshotName(m: FlowManifest): string {
	return m.appSource.type === "repo" ? m.appSource.runtimeSnapshot : m.appSnapshot;
}

function sortManifestsByPriority(manifests: FlowManifest[]): FlowManifest[] {
	const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
	return [...manifests].sort((a, b) => (rank[a.priority] ?? 99) - (rank[b.priority] ?? 99));
}

/**
 * Loads desktop flow configs from Supabase, optionally starts GCE Windows VMs,
 * runs the universal vision agent against each flow sequentially, and writes
 * results to test_runs / telemetry_events / storage.
 */
export async function computerUseRunWorkflow(input: ComputerUseRunWorkflowInput): Promise<ComputerUseRunFlowResult[]> {
	await validateComputerUseWorkflowStartActivity({
		apiKey: input.workflowApiKey,
		projectId: input.projectId,
		supabaseUrl: input.supabaseUrl,
		supabaseServiceRoleKey: input.supabaseServiceRoleKey,
	});

	const manifests = await loadComputerUseManifestsActivity({
		projectId: input.projectId,
		flowIds: input.flowIds,
		supabaseUrl: input.supabaseUrl,
		supabaseServiceRoleKey: input.supabaseServiceRoleKey,
	});

	if (manifests.length === 0) {
		return [];
	}

	const sorted = sortManifestsByPriority(manifests);
	const results: ComputerUseRunFlowResult[] = [];

	for (const manifest of sorted) {
		if (manifest.vmType === "windows") {
			await ensureGceWindowsVmForSnapshotActivity({
				snapshotName: provisionSnapshotName(manifest),
			});
		}

		const { testRunId } = await startComputerUseTestRunActivity({
			projectId: input.projectId,
			flowId: manifest.flowId,
			prNumber: input.prNumber,
			commitSha: input.commitSha,
			branchName: input.branchName,
			supabaseUrl: input.supabaseUrl,
			supabaseServiceRoleKey: input.supabaseServiceRoleKey,
		});

		const exec = await executeComputerUseFlowActivity({
			manifest,
			testRunId,
			projectId: input.projectId,
			supabaseUrl: input.supabaseUrl,
			supabaseServiceRoleKey: input.supabaseServiceRoleKey,
		});

		results.push({
			flowId: manifest.flowId,
			testRunId,
			success: exec.success,
			reason: exec.reason,
		});
	}

	return results;
}
