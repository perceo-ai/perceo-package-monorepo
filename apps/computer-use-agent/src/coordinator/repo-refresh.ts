import type { AppSourceRepo } from "../flow-manifest.js";

/**
 * Abstract VM process/shell handle for coordinator activities (restore, exec, env).
 * Wired to Hyper-V / EC2 / SSH per environment — not used by the universal agent loop.
 */
export type VmHandle = {
	id: string;
};

export type VmOrchestration = {
	restoreSnapshot(name: string): Promise<void>;
	exec(command: string): Promise<void>;
	execBackground(command: string): Promise<void>;
	setEnv(key: string, value: string): Promise<void>;
};

export type TemporalSecrets = {
	get(name: string): Promise<string>;
};

export type RepoRefreshDeps = {
	vm: VmOrchestration;
	vmHandle: VmHandle;
	source: AppSourceRepo;
	resolveBranch(): string;
	secrets: TemporalSecrets;
	waitUntilReady: (handle: VmHandle, startedWhen: string) => Promise<void>;
};

/**
 * Temporal activity body: clone/pull, build, start, wait for ready (PRD).
 * Integrations provide `VmOrchestration` + readiness probe.
 */
export async function repoRefreshActivity(deps: RepoRefreshDeps): Promise<void> {
	const { vm, source, secrets } = deps;
	await vm.restoreSnapshot(source.runtimeSnapshot);

	const branch = source.branch ?? deps.resolveBranch();

	const cloneBlock = `
    if [ -d repo ]; then
      cd repo && git fetch && git checkout ${branch} && git pull
    else
      git clone --branch ${branch} ${source.repoUrl} repo
    fi
  `;

	await vm.exec(cloneBlock);

	for (const secretName of source.envSecrets ?? []) {
		const value = await secrets.get(secretName);
		await vm.setEnv(secretName, value);
	}

	await vm.exec(`cd repo && ${source.buildScript}`);
	await vm.execBackground(`cd repo && ${source.startScript}`);
	await deps.waitUntilReady(deps.vmHandle, source.startedWhen);
}
