export type VmType = "windows" | "linux" | "macos";

/** Matches `flows.priority` in Supabase. */
export type FlowManifestPriority = "critical" | "high" | "medium" | "low";

export type CacheStrategy = "none" | "deps-only" | "full";

export type AppSourceInstalled = {
	type: "installed";
	/** Path to script run once to produce the snapshot (may be empty if snapshot was built out-of-band). */
	appSetupScript: string;
};

export type AppSourceRepo = {
	type: "repo";
	repoUrl: string;
	branch?: string;
	buildScript: string;
	startScript: string;
	startedWhen: string;
	envSecrets?: string[];
	runtimeSnapshot: string;
	cacheStrategy?: CacheStrategy;
};

export type AppSource = AppSourceInstalled | AppSourceRepo;

/**
 * Runtime shape the coordinator materializes from Supabase (`flows` + `flow_computer_use`).
 */
export type FlowManifest = {
	flowId: string;
	name: string;
	vmType: VmType;
	/**
	 * VM snapshot to restore for installed flows, or runtime base for repo flows (see PRD).
	 */
	appSnapshot: string;
	appSource: AppSource;
	goal: string;
	successCriteria: string;
	timeout: number;
	priority: FlowManifestPriority;
};

/** Snapshot name used when provisioning the VM (installed vs repo). */
export function resolveProvisionSnapshot(manifest: FlowManifest): string {
	if (manifest.appSource.type === "repo") {
		return manifest.appSource.runtimeSnapshot;
	}
	return manifest.appSnapshot;
}
