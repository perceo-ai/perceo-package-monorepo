import type { Flow, FlowComputerUse } from "@perceo/supabase";
import type { AppSource, FlowManifest } from "./flow-manifest.js";

export function materializeFlowManifest(flow: Flow, cu: FlowComputerUse): FlowManifest {
	const appSource: AppSource =
		cu.app_source_type === "installed"
			? { type: "installed", appSetupScript: cu.app_setup_script_path ?? "" }
			: {
					type: "repo",
					repoUrl: cu.repo_url ?? "",
					branch: cu.repo_branch ?? undefined,
					buildScript: cu.build_command ?? "",
					startScript: cu.start_command ?? "",
					startedWhen: cu.ready_wait_spec,
					envSecrets: cu.env_secret_names?.length ? cu.env_secret_names : undefined,
					runtimeSnapshot: cu.runtime_snapshot_name ?? "",
					cacheStrategy: cu.cache_strategy,
				};

	return {
		flowId: flow.id,
		name: flow.name,
		vmType: cu.vm_type,
		appSnapshot: cu.vm_snapshot_name,
		appSource,
		goal: cu.goal,
		successCriteria: cu.success_criteria,
		timeout: cu.timeout_seconds,
		priority: flow.priority,
	};
}
