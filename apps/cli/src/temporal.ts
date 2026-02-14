import { Connection, Client } from "@temporalio/client";

export interface TemporalConfig {
	address: string;
	namespace: string;
	taskQueue: string;
	apiKey?: string;
}

export function loadTemporalConfig(): TemporalConfig {
	const address = process.env.PERCEO_TEMPORAL_ADDRESS || "localhost:7233";
	const namespace = process.env.PERCEO_TEMPORAL_NAMESPACE || "perceo";
	const taskQueue = process.env.PERCEO_TEMPORAL_TASK_QUEUE || "observer-engine";
	const apiKey = process.env.PERCEO_TEMPORAL_API_KEY || undefined;

	if (!address || !namespace || !taskQueue) {
		throw new Error("Temporal config missing: PERCEO_TEMPORAL_ADDRESS / PERCEO_TEMPORAL_NAMESPACE / PERCEO_TEMPORAL_TASK_QUEUE");
	}

	return { address, namespace, taskQueue, apiKey };
}

export async function createTemporalClient() {
	const cfg = loadTemporalConfig();

	const connection = await Connection.connect({
		address: cfg.address,
		// For Temporal Cloud, enable TLS and API key auth.
		// For local development (localhost), TLS and apiKey are typically not required.
		tls: true,
		apiKey: cfg.apiKey,
	});

	const client = new Client({
		connection,
		namespace: cfg.namespace,
	});

	return { client, cfg };
}
