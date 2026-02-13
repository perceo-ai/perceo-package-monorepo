export interface WorkerConfig {
	taskQueue: string;
	namespace: string;
	serverAddress: string;
	tls?: {
		certPath: string;
		keyPath: string;
	};
	apiKey: string;
}

export function loadWorkerConfig(): WorkerConfig {
	const config: WorkerConfig = {
		taskQueue: process.env.PERCEO_TEMPORAL_TASK_QUEUE || "observer-engine",
		namespace: process.env.PERCEO_TEMPORAL_NAMESPACE || "perceo",
		serverAddress: process.env.PERCEO_TEMPORAL_ADDRESS || "localhost:7233",
		apiKey: process.env.PERCEO_TEMPORAL_API_KEY || "",
	};

	// Add TLS configuration if cert path is provided
	if (process.env.PERCEO_TEMPORAL_TLS_CERT_PATH) {
		if (!process.env.PERCEO_TEMPORAL_TLS_KEY_PATH) {
			throw new Error("PERCEO_TEMPORAL_TLS_KEY_PATH is required when PERCEO_TEMPORAL_TLS_CERT_PATH is set");
		}
		config.tls = {
			certPath: process.env.PERCEO_TEMPORAL_TLS_CERT_PATH,
			keyPath: process.env.PERCEO_TEMPORAL_TLS_KEY_PATH,
		};
	}

	return config;
}
