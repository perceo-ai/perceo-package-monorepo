export interface WorkerConfig {
	taskQueue: string;
	namespace: string;
	serverAddress: string;
	apiKey: string;
}

export function loadWorkerConfig(): WorkerConfig {
	const config: WorkerConfig = {
		taskQueue: process.env.PERCEO_TEMPORAL_TASK_QUEUE || "observer-engine",
		namespace: process.env.PERCEO_TEMPORAL_NAMESPACE || "perceo",
		serverAddress: process.env.PERCEO_TEMPORAL_ADDRESS || "localhost:7233",
		apiKey: process.env.PERCEO_TEMPORAL_API_KEY || "",
	};

	// Validate required LLM API key is present
	const llmApiKey = process.env.PERCEO_ANTHROPIC_API_KEY || process.env.PERCEO_OPEN_ROUTER_API_KEY;
	if (!llmApiKey) {
		console.warn("WARNING: No LLM API key configured. Set PERCEO_ANTHROPIC_API_KEY or PERCEO_OPEN_ROUTER_API_KEY");
	}

	return config;
}
