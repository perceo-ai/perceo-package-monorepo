export interface ObserverEngineConfig {
	observer: {
		watch: {
			paths: string[];
			ignore?: string[];
			debounceMs?: number;
			autoTest?: boolean;
		};
		ci?: {
			strategy?: "affected-flows" | string;
			parallelism?: number;
		};
		analysis?: {
			useLLM?: boolean;
			llmThreshold?: number;
		};
		/**
		 * Optional base URL and API key for managed Observer Engine APIs.
		 * When present, bootstrap and analysis operations will be delegated
		 * to the remote service.
		 */
		apiBaseUrl?: string;
		apiKey?: string;
	};
	flowGraph?: {
		endpoint: string;
		database?: string;
	};
	eventBus?: {
		type: "in-memory" | "redis";
		redisUrl?: string;
	};
}

export interface ChangeAnalysisFile {
	path: string;
	status: "added" | "modified" | "deleted" | "renamed";
}

export interface ChangeAnalysis {
	baseSha: string;
	headSha: string;
	files: ChangeAnalysisFile[];
}

export interface ImpactedFlow {
	name: string;
	confidence: number;
	riskScore: number;
	priority?: "critical" | "high" | "medium" | "low";
}

/**
 * Shape aligned with the ANALYSIS_COMPLETE event described in docs/cli_architecture.md.
 */
export interface ImpactReport {
	changeId: string;
	baseSha: string;
	headSha: string;
	flows: ImpactedFlow[];
	changes: ChangeAnalysisFile[];
	createdAt: number;
}

export interface BootstrapResult {
	projectName: string;
	framework: string;
	flowsInitialized: number;
	personasInitialized: number;
	warnings?: string[];
}

export interface BootstrapOptions {
	projectDir: string;
	projectName: string;
	framework: string;
}
