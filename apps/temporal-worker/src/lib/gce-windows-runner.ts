import { InstancesClient } from "@google-cloud/compute";

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveGceInstanceForSnapshot(snapshotName: string): string {
	const raw = process.env.PERCEO_GCE_INSTANCE_BY_SNAPSHOT_JSON;
	if (raw) {
		const map = JSON.parse(raw) as Record<string, string>;
		const mapped = map[snapshotName];
		if (mapped) {
			return mapped;
		}
	}

	const fallback = process.env.PERCEO_GCE_WINDOWS_INSTANCE_NAME;
	if (fallback) {
		return fallback;
	}

	throw new Error(
		`No GCE instance mapping for snapshot "${snapshotName}". Set PERCEO_GCE_INSTANCE_BY_SNAPSHOT_JSON ` +
			`or PERCEO_GCE_WINDOWS_INSTANCE_NAME (or PERCEO_GCE_SKIP=true for local testing).`,
	);
}

export async function ensureGceInstanceRunning(params: { projectId: string; zone: string; instanceName: string }): Promise<void> {
	const client = new InstancesClient();
	const getReq = { project: params.projectId, zone: params.zone, instance: params.instanceName };

	const [instance] = await client.get(getReq);

	if (instance.status === "RUNNING") {
		return;
	}

	if (instance.status === "STAGING" || instance.status === "PROVISIONING") {
		await waitUntilRunning(client, getReq);
		return;
	}

	if (instance.status === "TERMINATED" || instance.status === "STOPPED") {
		await client.start(getReq);
	}

	await waitUntilRunning(client, getReq);
}

async function waitUntilRunning(client: InstancesClient, getReq: { project: string; zone: string; instance: string }): Promise<void> {
	const maxAttempts = 120;
	for (let i = 0; i < maxAttempts; i++) {
		const [inst] = await client.get(getReq);
		if (inst.status === "RUNNING") {
			return;
		}
		await sleep(5000);
	}
	throw new Error(`GCE instance ${getReq.instance} did not reach RUNNING in time`);
}
