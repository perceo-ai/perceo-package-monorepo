/**
 * Perceo Supabase Database Types
 * Auto-generated from database schema
 */

// ============================================================================
// Base Types
// ============================================================================

export type UUID = string;
export type Timestamp = string; // ISO 8601 format

// ============================================================================
// Enums
// ============================================================================

export type ProjectRole = "owner" | "admin" | "member" | "viewer";
export type FlowPriority = "critical" | "high" | "medium" | "low";
export type TestStatus = "pending" | "running" | "passed" | "failed" | "error" | "skipped";
export type TestTrigger = "pr" | "watch" | "manual" | "schedule" | "ci";
export type InsightType = "discrepancy" | "coverage-gap" | "ux-issue" | "prediction" | "performance" | "regression";
export type InsightSeverity = "critical" | "high" | "medium" | "low" | "info";
export type InsightStatus = "open" | "acknowledged" | "in_progress" | "resolved" | "dismissed" | "false_positive";
export type PredictionBasis = "ml-model" | "heuristic" | "pattern" | "historical";
export type RiskLevel = "critical" | "high" | "medium" | "low";
export type EventSource = "observer" | "coordinator" | "analyzer" | "analytics" | "cli" | "dashboard";
export type AnalyticsProvider = "ga4" | "mixpanel" | "amplitude" | "posthog" | "custom";
export type SyncStatus = "success" | "failed" | "partial";

// API Key scopes
export type ApiKeyScope =
	| "ci:analyze" // Run perceo ci analyze
	| "ci:test" // Run perceo ci test
	| "flows:read" // Read flows
	| "flows:write" // Create/update flows
	| "insights:read" // Read insights
	| "events:publish" // Publish events
	| "workflows:start"; // Start Temporal workflows

// ============================================================================
// Table Types
// ============================================================================

export interface Project {
	id: UUID;
	name: string;
	framework: string | null;
	config: Record<string, unknown>;
	git_remote_url: string | null;
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface ProjectMember {
	project_id: UUID;
	user_id: UUID;
	role: ProjectRole;
	created_at: Timestamp;
}

export interface Persona {
	id: UUID;
	project_id: UUID;
	name: string;
	description: string | null;
	behaviors: Record<string, unknown>;
	source: "user_configured" | "auto_generated";
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface Flow {
	id: UUID;
	project_id: UUID;
	persona_id: UUID | null;
	name: string;
	description: string | null;
	priority: FlowPriority;
	entry_point: string | null;
	graph_data: Record<string, unknown>;
	affected_by_changes: string[];
	risk_score: number;
	coverage_score: number | null;
	is_active: boolean;
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface StepAction {
	type: "click" | "fill" | "navigate" | "wait" | "scroll" | "hover" | "assert" | "screenshot";
	target?: string;
	value?: string;
	options?: Record<string, unknown>;
}

export interface StepExpectedState {
	url?: string;
	visible?: string[];
	hidden?: string[];
	text?: Record<string, string>;
	attributes?: Record<string, Record<string, string>>;
}

export interface Step {
	id: UUID;
	flow_id: UUID;
	sequence_order: number;
	name: string;
	actions: StepAction[];
	expected_state: StepExpectedState;
	timeout_ms: number;
	retry_count: number;
	next_step_id: UUID | null;
	branch_config: {
		condition: string;
		trueStepId: UUID;
		falseStepId: UUID;
	} | null;
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface FlowMetrics {
	id: UUID;
	flow_id: UUID;
	synthetic_success_rate: number | null;
	synthetic_avg_duration_ms: number | null;
	synthetic_p50_duration_ms: number | null;
	synthetic_p95_duration_ms: number | null;
	synthetic_last_run: Timestamp | null;
	synthetic_run_count: number;
	prod_success_rate: number | null;
	prod_daily_users: number | null;
	prod_weekly_users: number | null;
	prod_avg_duration_ms: number | null;
	prod_top_exit_step: string | null;
	prod_conversion_rate: number | null;
	prod_device_breakdown: Record<string, number>;
	prod_cohort_performance: Record<string, { success_rate: number }>;
	prod_last_updated: Timestamp | null;
	gap_score: number | null;
	updated_at: Timestamp;
}

export interface TestRun {
	id: UUID;
	flow_id: UUID | null;
	project_id: UUID;
	status: TestStatus;
	duration_ms: number | null;
	error_message: string | null;
	error_stack: string | null;
	failed_step_id: UUID | null;
	screenshots: string[];
	video_url: string | null;
	logs: unknown[];
	triggered_by: TestTrigger | null;
	pr_number: number | null;
	commit_sha: string | null;
	branch_name: string | null;
	agent_id: string | null;
	agent_type: string | null;
	created_at: Timestamp;
	started_at: Timestamp | null;
	completed_at: Timestamp | null;
}

export interface AnalyticsEvent {
	id: UUID;
	project_id: UUID;
	event_type: string;
	event_name: string | null;
	user_id: string | null;
	session_id: string | null;
	anonymous_id: string | null;
	flow_id: UUID | null;
	flow_step: string | null;
	flow_confidence: number | null;
	url: string | null;
	page_path: string | null;
	referrer: string | null;
	device_type: string | null;
	browser: string | null;
	os: string | null;
	screen_resolution: string | null;
	metadata: Record<string, unknown>;
	provider: AnalyticsProvider | null;
	provider_event_id: string | null;
	created_at: Timestamp;
}

export interface Insight {
	id: UUID;
	project_id: UUID;
	flow_id: UUID | null;
	type: InsightType;
	severity: InsightSeverity;
	title: string;
	message: string;
	suggested_action: string | null;
	evidence: Record<string, unknown>;
	revenue_impact: {
		estimated_monthly_loss?: number;
		confidence?: number;
		affected_users?: number;
	} | null;
	status: InsightStatus;
	resolved_by: UUID | null;
	resolution_notes: string | null;
	created_at: Timestamp;
	acknowledged_at: Timestamp | null;
	resolved_at: Timestamp | null;
}

export interface Prediction {
	id: UUID;
	project_id: UUID;
	flow_id: UUID;
	pr_number: number | null;
	commit_sha: string | null;
	branch_name: string | null;
	probability: number;
	confidence: number;
	reasoning: string | null;
	based_on: PredictionBasis | null;
	model_version: string | null;
	features: Record<string, unknown>;
	actual_result: TestStatus | null;
	prediction_correct: boolean | null;
	created_at: Timestamp;
	validated_at: Timestamp | null;
}

export interface PerceoEvent {
	id: UUID;
	project_id: UUID | null;
	type: string;
	payload: Record<string, unknown>;
	source: EventSource | null;
	processed: boolean;
	processed_at: Timestamp | null;
	created_at: Timestamp;
}

export interface CodeChange {
	id: UUID;
	project_id: UUID;
	base_sha: string;
	head_sha: string;
	branch_name: string | null;
	pr_number: number | null;
	files: {
		path: string;
		status: "added" | "modified" | "deleted" | "renamed";
		additions?: number;
		deletions?: number;
	}[];
	risk_level: RiskLevel | null;
	risk_score: number | null;
	affected_flow_ids: UUID[];
	llm_analysis: {
		summary?: string;
		impacted_areas?: string[];
		recommendations?: string[];
	} | null;
	created_at: Timestamp;
	analyzed_at: Timestamp | null;
}

export interface AnalyticsConnection {
	id: UUID;
	project_id: UUID;
	provider: AnalyticsProvider;
	provider_account_id: string | null;
	config: Record<string, unknown>;
	last_sync_at: Timestamp | null;
	last_sync_status: SyncStatus | null;
	last_sync_error: string | null;
	events_synced_count: number;
	sync_interval_seconds: number;
	sync_enabled: boolean;
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface ProjectApiKey {
	id: UUID;
	project_id: UUID;
	name: string;
	key_hash: string;
	key_prefix: string;
	scopes: ApiKeyScope[];
	created_by: UUID | null;
	created_at: Timestamp;
	last_used_at: Timestamp | null;
	last_used_ip: string | null;
	expires_at: Timestamp | null;
	revoked_at: Timestamp | null;
	revoked_by: UUID | null;
	revocation_reason: string | null;
}

export interface ProjectApiKeyAudit {
	id: UUID;
	key_id: UUID;
	action: "created" | "used" | "revoked" | "expired";
	actor_id: UUID | null;
	ip_address: string | null;
	user_agent: string | null;
	metadata: Record<string, unknown>;
	created_at: Timestamp;
}

// ============================================================================
// Insert Types (for creating new records)
// ============================================================================

export type ProjectInsert = Omit<Project, "id" | "created_at" | "updated_at"> & {
	id?: UUID;
};

export type PersonaInsert = Omit<Persona, "id" | "created_at" | "updated_at"> & {
	id?: UUID;
	behaviors?: Record<string, unknown>;
};

export type FlowInsert = Omit<Flow, "id" | "created_at" | "updated_at" | "affected_by_changes" | "risk_score"> & {
	id?: UUID;
	affected_by_changes?: string[];
	risk_score?: number;
	graph_data?: Record<string, unknown>;
	priority?: FlowPriority;
	is_active?: boolean;
};

export type StepInsert = Omit<Step, "id" | "created_at" | "updated_at"> & {
	id?: UUID;
	actions?: StepAction[];
	expected_state?: StepExpectedState;
	timeout_ms?: number;
	retry_count?: number;
};

export type TestRunInsert = Omit<TestRun, "id" | "created_at"> & {
	id?: UUID;
	screenshots?: string[];
	logs?: unknown[];
};

export type InsightInsert = Omit<Insight, "id" | "created_at" | "acknowledged_at" | "resolved_at"> & {
	id?: UUID;
	evidence?: Record<string, unknown>;
	status?: InsightStatus;
};

export type CodeChangeInsert = {
	project_id: UUID;
	base_sha: string;
	head_sha: string;
	files: {
		path: string;
		status: "added" | "modified" | "deleted" | "renamed";
		additions?: number;
		deletions?: number;
	}[];
	id?: UUID;
	branch_name?: string | null;
	pr_number?: number | null;
	risk_level?: RiskLevel | null;
	risk_score?: number | null;
	affected_flow_ids?: UUID[];
	llm_analysis?: {
		summary?: string;
		impacted_areas?: string[];
		recommendations?: string[];
	} | null;
};

export type PerceoEventInsert = Omit<PerceoEvent, "id" | "created_at" | "processed" | "processed_at"> & {
	id?: UUID;
};

export type ProjectApiKeyInsert = {
	project_id: UUID;
	name: string;
	key_hash: string;
	key_prefix: string;
	scopes: ApiKeyScope[];
	created_by?: UUID | null;
	expires_at?: Timestamp | null;
};

export type ProjectApiKeyUpdate = {
	name?: string;
	scopes?: ApiKeyScope[];
	expires_at?: Timestamp | null;
	revoked_at?: Timestamp | null;
	revoked_by?: UUID | null;
	revocation_reason?: string | null;
};

// ============================================================================
// Update Types
// ============================================================================

export type FlowUpdate = Partial<Omit<Flow, "id" | "project_id" | "created_at">>;
export type TestRunUpdate = Partial<Omit<TestRun, "id" | "project_id" | "created_at">>;
export type InsightUpdate = Partial<Omit<Insight, "id" | "project_id" | "created_at">>;

// ============================================================================
// Query Types
// ============================================================================

export interface FlowWithSteps extends Flow {
	steps: Step[];
}

export interface FlowWithMetrics extends Flow {
	metrics: FlowMetrics | null;
}

export interface TestRunWithFlow extends TestRun {
	flow: Flow | null;
}

export interface InsightWithFlow extends Insight {
	flow: Flow | null;
}

// ============================================================================
// Realtime Event Types
// ============================================================================

export type RealtimeEventType = "INSERT" | "UPDATE" | "DELETE";

export interface RealtimePayload<T> {
	eventType: RealtimeEventType;
	new: T;
	old: T | null;
	schema: string;
	table: string;
	commit_timestamp: string;
}

// ============================================================================
// Database Schema Type (for Supabase client)
// ============================================================================

export interface Database {
	public: {
		Tables: {
			projects: {
				Row: Project;
				Insert: ProjectInsert;
				Update: Partial<ProjectInsert>;
			};
			project_members: {
				Row: ProjectMember;
				Insert: Omit<ProjectMember, "created_at">;
				Update: Partial<Omit<ProjectMember, "project_id" | "user_id" | "created_at">>;
			};
			personas: {
				Row: Persona;
				Insert: PersonaInsert;
				Update: Partial<PersonaInsert>;
			};
			flows: {
				Row: Flow;
				Insert: FlowInsert;
				Update: FlowUpdate;
			};
			steps: {
				Row: Step;
				Insert: StepInsert;
				Update: Partial<StepInsert>;
			};
			flow_metrics: {
				Row: FlowMetrics;
				Insert: Omit<FlowMetrics, "id" | "updated_at">;
				Update: Partial<Omit<FlowMetrics, "id" | "flow_id" | "updated_at">>;
			};
			test_runs: {
				Row: TestRun;
				Insert: TestRunInsert;
				Update: TestRunUpdate;
			};
			analytics_events: {
				Row: AnalyticsEvent;
				Insert: Omit<AnalyticsEvent, "id" | "created_at">;
				Update: never;
			};
			insights: {
				Row: Insight;
				Insert: InsightInsert;
				Update: InsightUpdate;
			};
			predictions: {
				Row: Prediction;
				Insert: Omit<Prediction, "id" | "created_at" | "validated_at">;
				Update: Partial<Omit<Prediction, "id" | "project_id" | "flow_id" | "created_at">>;
			};
			events: {
				Row: PerceoEvent;
				Insert: PerceoEventInsert;
				Update: Partial<Omit<PerceoEvent, "id" | "created_at">>;
			};
			code_changes: {
				Row: CodeChange;
				Insert: CodeChangeInsert;
				Update: Partial<Omit<CodeChange, "id" | "project_id" | "created_at">>;
			};
			analytics_connections: {
				Row: AnalyticsConnection;
				Insert: Omit<AnalyticsConnection, "id" | "created_at" | "updated_at">;
				Update: Partial<Omit<AnalyticsConnection, "id" | "project_id" | "created_at">>;
			};
			project_api_keys: {
				Row: ProjectApiKey;
				Insert: ProjectApiKeyInsert;
				Update: ProjectApiKeyUpdate;
			};
		};
	};
}
