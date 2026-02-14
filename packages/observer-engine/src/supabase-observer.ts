/**
 * Supabase-Powered Observer Engine
 *
 * Implements the Observer Engine workflow using Supabase for:
 * - Persistent storage of code changes, flows, and analysis results
 * - Realtime event bus via Supabase Realtime (replaces Redis pub/sub)
 * - File watching with change detection and flow impact analysis
 */

import chokidar, { type FSWatcher } from "chokidar";
import { PerceoDataClient, getSupabaseUrl, getSupabaseAnonKey, type Flow, type CodeChange, type FlowInsert, type RealtimePayload, type TestRun, type Insight } from "@perceo/supabase";
import { computeChangeAnalysis } from "./git.js";
import type { ChangeAnalysisFile, ImpactedFlow, ImpactReport, ObserverEngineConfig } from "./types.js";

// ============================================================================
// Types
// ============================================================================

export interface SupabaseObserverConfig {
	supabaseUrl: string;
	supabaseKey: string;
	projectId: string;
	projectName: string;

	watch?: {
		paths: string[];
		ignore?: string[];
		debounceMs?: number;
	};

	analysis?: {
		useLLM?: boolean;
		llmThreshold?: number;
	};
}

export interface FileChange {
	path: string;
	type: "add" | "change" | "unlink";
	timestamp: number;
}

export interface ObserverCallbacks {
	onFileChange?: (change: FileChange) => void | Promise<void>;
	onAnalysisStart?: (changeId: string) => void | Promise<void>;
	onAnalysisComplete?: (report: ImpactReport) => void | Promise<void>;
	onFlowsAffected?: (flows: ImpactedFlow[]) => void | Promise<void>;
	onTestRunUpdate?: (testRun: TestRun) => void | Promise<void>;
	onInsightCreated?: (insight: Insight) => void | Promise<void>;
	onError?: (error: Error) => void | Promise<void>;
}

// ============================================================================
// Supabase Observer Engine
// ============================================================================

export class SupabaseObserverEngine {
	private readonly config: SupabaseObserverConfig;
	private readonly client: PerceoDataClient;
	private readonly callbacks: ObserverCallbacks;

	private watcher: FSWatcher | null = null;
	private pendingChanges: Map<string, FileChange> = new Map();
	private debounceTimer: NodeJS.Timeout | null = null;
	private isAnalyzing = false;

	constructor(config: SupabaseObserverConfig, callbacks: ObserverCallbacks = {}) {
		this.config = config;
		this.callbacks = callbacks;
		this.client = new PerceoDataClient({
			supabaseUrl: config.supabaseUrl,
			supabaseKey: config.supabaseKey,
			projectId: config.projectId,
		});
	}

	/**
	 * Create from observer engine config (backwards compatible)
	 */
	static fromConfig(config: ObserverEngineConfig, projectId: string, projectName: string, callbacks?: ObserverCallbacks): SupabaseObserverEngine | null {
		const supabaseUrl = getSupabaseUrl();
		const supabaseKey = process.env.PERCEO_SUPABASE_SERVICE_ROLE_KEY || getSupabaseAnonKey();

		return new SupabaseObserverEngine(
			{
				supabaseUrl,
				supabaseKey,
				projectId,
				projectName,
				watch: config.observer.watch,
				analysis: config.observer.analysis,
			},
			callbacks,
		);
	}

	/**
	 * Start watching for file changes
	 */
	async startWatch(projectRoot: string): Promise<void> {
		const watchPaths = this.config.watch?.paths ?? ["src/", "app/", "pages/", "components/"];
		const ignorePaths = this.config.watch?.ignore ?? ["node_modules/", ".next/", ".git/", "dist/"];
		const debounceMs = this.config.watch?.debounceMs ?? 500;

		// Set up realtime subscriptions
		await this.setupRealtimeSubscriptions();

		// Initialize file watcher
		this.watcher = chokidar.watch(
			watchPaths.map((p) => `${projectRoot}/${p}`),
			{
				ignored: ignorePaths.map((p) => `**/${p}**`),
				ignoreInitial: true,
				persistent: true,
				awaitWriteFinish: {
					stabilityThreshold: 100,
					pollInterval: 50,
				},
			},
		);

		// Handle file events
		this.watcher.on("add", (path) => this.handleFileChange(path, "add"));
		this.watcher.on("change", (path) => this.handleFileChange(path, "change"));
		this.watcher.on("unlink", (path) => this.handleFileChange(path, "unlink"));

		this.watcher.on("error", (error) => {
			this.callbacks.onError?.(error);
		});

		// Debounce changes and analyze
		this.watcher.on("all", () => {
			if (this.debounceTimer) {
				clearTimeout(this.debounceTimer);
			}
			this.debounceTimer = setTimeout(() => {
				this.processChanges(projectRoot);
			}, debounceMs);
		});
	}

	/**
	 * Stop watching for file changes
	 */
	async stopWatch(): Promise<void> {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}

		if (this.watcher) {
			await this.watcher.close();
			this.watcher = null;
		}

		await this.client.cleanup();
	}

	/**
	 * Set up Supabase Realtime subscriptions
	 */
	private async setupRealtimeSubscriptions(): Promise<void> {
		const projectId = this.config.projectId;

		// Subscribe to test run updates
		this.client.subscribeToTestRuns(projectId, (payload) => {
			if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
				this.callbacks.onTestRunUpdate?.(payload.new);
			}
		});

		// Subscribe to new insights
		this.client.subscribeToInsights(projectId, (payload) => {
			if (payload.eventType === "INSERT") {
				this.callbacks.onInsightCreated?.(payload.new);
			}
		});

		// Subscribe to flow changes
		this.client.subscribeToFlows(projectId, (payload) => {
			if (payload.eventType === "UPDATE" && payload.new.affected_by_changes?.length > 0) {
				const impactedFlow: ImpactedFlow = {
					name: payload.new.name,
					confidence: 0.8,
					riskScore: payload.new.risk_score,
					priority: payload.new.priority,
				};
				this.callbacks.onFlowsAffected?.([impactedFlow]);
			}
		});
	}

	/**
	 * Handle individual file change
	 */
	private handleFileChange(path: string, type: "add" | "change" | "unlink"): void {
		const change: FileChange = {
			path,
			type,
			timestamp: Date.now(),
		};

		this.pendingChanges.set(path, change);
		this.callbacks.onFileChange?.(change);
	}

	/**
	 * Process accumulated changes
	 */
	private async processChanges(projectRoot: string): Promise<void> {
		if (this.isAnalyzing || this.pendingChanges.size === 0) {
			return;
		}

		this.isAnalyzing = true;
		const changes = Array.from(this.pendingChanges.values());
		this.pendingChanges.clear();

		try {
			// Get current HEAD and compute a synthetic "base" (could be last commit)
			const headSha = await this.getCurrentHead(projectRoot);
			const baseSha = `${headSha}~1`; // Previous commit
			const changeId = `change-${Date.now()}`;

			this.callbacks.onAnalysisStart?.(changeId);

			// Compute change analysis using git diff
			const analysis = await computeChangeAnalysis(projectRoot, baseSha, headSha);

			// Store code change in Supabase
			const codeChange = await this.client.createCodeChange({
				project_id: this.config.projectId,
				base_sha: baseSha,
				head_sha: headSha,
				files: analysis.files.map((f) => ({
					path: f.path,
					status: f.status,
				})),
			});

			// Get all flows for the project
			const flows = await this.client.getFlows(this.config.projectId);

			// Match affected flows based on file patterns
			const affectedFlows = await this.matchAffectedFlows(flows, analysis.files);

			// Update code change with analysis results
			const riskScore = this.calculateRiskScore(affectedFlows);
			const riskLevel = this.getRiskLevel(riskScore);

			await this.client.updateCodeChangeAnalysis(codeChange.id, {
				risk_level: riskLevel,
				risk_score: riskScore,
				affected_flow_ids: affectedFlows.map((f) => f.id),
			});

			// Mark flows as affected (updates risk score and affected_by_changes)
			await this.client.markFlowsAffected(
				affectedFlows.map((f) => f.id),
				codeChange.id,
				riskScore * 0.2,
			);

			// Publish event to realtime bus
			await this.client.publishFlowsAffected(
				codeChange.id,
				affectedFlows.map((f) => ({
					id: f.id,
					name: f.name,
					riskScore: f.risk_score,
				})),
				"observer",
			);

			// Build and return impact report
			const impactReport: ImpactReport = {
				changeId: codeChange.id,
				baseSha,
				headSha,
				flows: affectedFlows.map((f) => ({
					name: f.name,
					confidence: 0.8, // TODO: Use LLM for better confidence
					riskScore: f.risk_score,
					priority: f.priority,
				})),
				changes: analysis.files,
				createdAt: Date.now(),
			};

			this.callbacks.onAnalysisComplete?.(impactReport);
			this.callbacks.onFlowsAffected?.(impactReport.flows);
		} catch (error) {
			this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
		} finally {
			this.isAnalyzing = false;
		}
	}

	/**
	 * Match flows affected by changed files
	 */
	private async matchAffectedFlows(flows: Flow[], changedFiles: ChangeAnalysisFile[]): Promise<Flow[]> {
		const affectedFlows: Flow[] = [];

		for (const flow of flows) {
			// Check if any changed file matches flow patterns
			const isAffected = this.doesFlowMatchChanges(flow, changedFiles);
			if (isAffected) {
				affectedFlows.push(flow);
			}
		}

		return affectedFlows;
	}

	/**
	 * Check if a flow is affected by changed files
	 */
	private doesFlowMatchChanges(flow: Flow, changedFiles: ChangeAnalysisFile[]): boolean {
		// Check flow entry point
		if (flow.entry_point) {
			for (const file of changedFiles) {
				if (this.pathMatchesPattern(file.path, flow.entry_point)) {
					return true;
				}
			}
		}

		// Check flow graph data for component/page references
		const graphData = flow.graph_data as
			| {
					components?: string[];
					pages?: string[];
					dependencies?: string[];
			  }
			| undefined;

		if (graphData) {
			const patterns = [...(graphData.components ?? []), ...(graphData.pages ?? []), ...(graphData.dependencies ?? [])];

			for (const pattern of patterns) {
				for (const file of changedFiles) {
					if (this.pathMatchesPattern(file.path, pattern)) {
						return true;
					}
				}
			}
		}

		// Check flow name for common patterns
		const flowKeywords = flow.name.toLowerCase().split(/[\s-_]+/);
		for (const file of changedFiles) {
			const filePath = file.path.toLowerCase();
			for (const keyword of flowKeywords) {
				if (filePath.includes(keyword) && keyword.length > 3) {
					return true;
				}
			}
		}

		return false;
	}

	/**
	 * Check if a file path matches a pattern
	 */
	private pathMatchesPattern(filePath: string, pattern: string): boolean {
		const normalizedPath = filePath.toLowerCase();
		const normalizedPattern = pattern.toLowerCase();

		// Direct match
		if (normalizedPath.includes(normalizedPattern)) {
			return true;
		}

		// Component/module name match
		const fileName =
			filePath
				.split("/")
				.pop()
				?.replace(/\.[^/.]+$/, "") ?? "";
		if (fileName.toLowerCase() === normalizedPattern.replace(/\.[^/.]+$/, "").toLowerCase()) {
			return true;
		}

		return false;
	}

	/**
	 * Calculate aggregate risk score from affected flows
	 */
	private calculateRiskScore(flows: Flow[]): number {
		if (flows.length === 0) return 0;

		// Weight by flow priority
		const priorityWeights: Record<string, number> = {
			critical: 1.0,
			high: 0.75,
			medium: 0.5,
			low: 0.25,
		};

		let totalWeight = 0;
		let weightedScore = 0;

		for (const flow of flows) {
			const weight = priorityWeights[flow.priority ?? "medium"] ?? 0.5;
			totalWeight += weight;
			weightedScore += weight * (flow.risk_score + 0.3); // Base risk for being affected
		}

		return Math.min(1.0, weightedScore / Math.max(totalWeight, 1));
	}

	/**
	 * Get risk level from score
	 */
	private getRiskLevel(score: number): "critical" | "high" | "medium" | "low" {
		if (score >= 0.8) return "critical";
		if (score >= 0.6) return "high";
		if (score >= 0.3) return "medium";
		return "low";
	}

	/**
	 * Get current HEAD commit SHA
	 */
	private async getCurrentHead(projectRoot: string): Promise<string> {
		const { execSync } = await import("child_process");
		try {
			return execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf-8" }).trim();
		} catch {
			return "HEAD";
		}
	}

	// ==========================================================================
	// Public API Methods
	// ==========================================================================

	/**
	 * Manually analyze changes between two commits
	 */
	async analyzeChanges(projectRoot: string, baseSha: string, headSha: string): Promise<ImpactReport> {
		const analysis = await computeChangeAnalysis(projectRoot, baseSha, headSha);

		// Store code change
		const codeChange = await this.client.createCodeChange({
			project_id: this.config.projectId,
			base_sha: baseSha,
			head_sha: headSha,
			files: analysis.files.map((f) => ({
				path: f.path,
				status: f.status,
			})),
		});

		// Get flows and match
		const flows = await this.client.getFlows(this.config.projectId);
		const affectedFlows = await this.matchAffectedFlows(flows, analysis.files);

		// Update analysis
		const riskScore = this.calculateRiskScore(affectedFlows);
		await this.client.updateCodeChangeAnalysis(codeChange.id, {
			risk_level: this.getRiskLevel(riskScore),
			risk_score: riskScore,
			affected_flow_ids: affectedFlows.map((f) => f.id),
		});

		// Mark flows affected
		await this.client.markFlowsAffected(
			affectedFlows.map((f) => f.id),
			codeChange.id,
			riskScore * 0.2,
		);

		// Publish event
		await this.client.publishFlowsAffected(
			codeChange.id,
			affectedFlows.map((f) => ({
				id: f.id,
				name: f.name,
				riskScore: f.risk_score,
			})),
			"observer",
		);

		return {
			changeId: codeChange.id,
			baseSha,
			headSha,
			flows: affectedFlows.map((f) => ({
				name: f.name,
				confidence: 0.8,
				riskScore: f.risk_score,
				priority: f.priority,
			})),
			changes: analysis.files,
			createdAt: Date.now(),
		};
	}

	/**
	 * Get all flows for the project
	 */
	async getFlows(): Promise<Flow[]> {
		return this.client.getFlows(this.config.projectId);
	}

	/**
	 * Get flows affected by recent changes
	 */
	async getAffectedFlows(): Promise<Flow[]> {
		return this.client.getAffectedFlows(this.config.projectId);
	}

	/**
	 * Create or update flows (bootstrap)
	 */
	async upsertFlows(flows: FlowInsert[]): Promise<Flow[]> {
		return this.client.upsertFlows(
			flows.map((f) => ({
				...f,
				project_id: this.config.projectId,
			})),
		);
	}

	/**
	 * Clear affected status from flows (e.g., after tests pass)
	 */
	async clearAffectedFlows(flowIds: string[]): Promise<void> {
		await this.client.clearAffectedFlows(flowIds);
	}

	/**
	 * Get the data client for direct access
	 */
	getDataClient(): PerceoDataClient {
		return this.client;
	}
}
