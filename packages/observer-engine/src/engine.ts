import type { BootstrapOptions, BootstrapResult, ChangeAnalysis, ImpactReport, ObserverEngineConfig } from "./types.js";
import { ObserverApiClient } from "./client.js";
import { computeChangeAnalysis } from "./git.js";

export interface PerceoEvent<T = any> {
	id: string;
	type: string;
	timestamp: number;
	source: "observer" | "coordinator" | "analytics" | "analyzer" | "graph";
	data: T;
	metadata?: {
		userId?: string;
		projectId?: string;
		environment?: string;
	};
}

export interface EventBusLike {
	publish<T>(event: PerceoEvent<T>): Promise<void> | void;
}

export interface FlowGraphClientLike {
	// Minimal surface needed today; can be expanded as flow graph support lands.
	upsertFlows?(flows: unknown[]): Promise<void>;
}

export interface ObserverEngineDeps {
	eventBus?: EventBusLike;
	flowGraph?: FlowGraphClientLike;
}

export class ObserverEngine {
	private readonly config: ObserverEngineConfig;
	private readonly deps: ObserverEngineDeps;
	private readonly apiClient: ObserverApiClient | null;

	constructor(config: ObserverEngineConfig, deps: ObserverEngineDeps = {}) {
		this.config = config;
		this.deps = deps;
		this.apiClient = ObserverApiClient.fromConfig(config);
	}

	/**
	 * Bootstrap flows/personas for the current project.
	 *
	 * Delegates to the managed Observer API when configured, otherwise returns
	 * a fast local no-op result so init remains non-blocking.
	 */
	async bootstrapProject(options: BootstrapOptions): Promise<BootstrapResult> {
		if (!this.apiClient) {
			return {
				projectName: options.projectName,
				framework: options.framework,
				flowsInitialized: 0,
				personasInitialized: 0,
				warnings: ["Observer managed API is not configured; skipping remote bootstrap."],
			};
		}

		const result = await this.apiClient.bootstrapProject(options);

		// In the future we can upsert flows/personas into the flow graph here.
		if (this.deps.flowGraph && Array.isArray((result as any).flows)) {
			await this.deps.flowGraph.upsertFlows?.((result as any).flows);
		}

		return result;
	}

	/**
	 * Analyze changes between two Git refs and return an ImpactReport.
	 *
	 * Uses local Git diff to build a ChangeAnalysis, then delegates to the
	 * managed Observer API when configured. If no API is configured, returns
	 * a minimal, local-only report that still captures the changed files.
	 */
	async analyzeChanges(params: { baseSha: string; headSha: string; projectRoot: string }): Promise<ImpactReport> {
		const change: ChangeAnalysis = await computeChangeAnalysis(params.projectRoot, params.baseSha, params.headSha);

		let report: ImpactReport;

		if (this.apiClient) {
			report = await this.apiClient.analyzeChanges(change);
		} else {
			// Local fallback: no real intelligence yet, just echo the change.
			report = {
				changeId: `${params.baseSha}...${params.headSha}`,
				baseSha: params.baseSha,
				headSha: params.headSha,
				flows: [],
				changes: change.files,
				createdAt: Date.now(),
			};
		}

		// Publish ANALYSIS_COMPLETE event when an event bus is available.
		if (this.deps.eventBus) {
			const event: PerceoEvent<ImpactReport> = {
				id: report.changeId,
				type: "observer.analysis.complete",
				timestamp: report.createdAt,
				source: "observer",
				data: report,
			};
			await this.deps.eventBus.publish(event);
		}

		return report;
	}

	/**
	 * Core entry point for watch-mode integration.
	 *
	 * The CLI is expected to provide a stream of file changes; this method
	 * will wire those into the Observer pipeline and return a disposer to
	 * stop processing. The detailed implementation will be filled in when
	 * watch support is built out.
	 */
	async startWatchCore(_options: { onChange: (change: { path: string; type: "add" | "change" | "unlink" }) => void | Promise<void> }): Promise<() => Promise<void>> {
		// For now we don't implement watch logic; this is a placeholder that
		// keeps the API stable for the future.
		return async () => {
			// no-op stop handler for now
		};
	}
}
