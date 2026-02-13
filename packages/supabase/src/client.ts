/**
 * Perceo Supabase Data Client
 * 
 * Provides typed CRUD operations and realtime subscriptions for all Perceo tables.
 * This client is used by the Observer Engine, CLI, and Dashboard.
 */

import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";
import type {
  Flow,
  FlowInsert,
  FlowUpdate,
  FlowWithSteps,
  FlowWithMetrics,
  Step,
  StepInsert,
  TestRun,
  TestRunInsert,
  TestRunUpdate,
  Insight,
  InsightInsert,
  InsightUpdate,
  CodeChange,
  CodeChangeInsert,
  PerceoEvent,
  PerceoEventInsert,
  Project,
  ProjectInsert,
  Persona,
  PersonaInsert,
  FlowMetrics,
  Prediction,
  RealtimePayload,
  UUID,
  EventSource,
  ProjectApiKey,
  ProjectApiKeyInsert,
  ApiKeyScope,
} from "./types.js";
import { createHash, randomBytes } from "crypto";

// ============================================================================
// Configuration
// ============================================================================

export interface PerceoClientConfig {
  supabaseUrl: string;
  supabaseKey: string;
  projectId?: string;
}

// ============================================================================
// Main Client Class
// ============================================================================

export class PerceoDataClient {
  private readonly supabase: SupabaseClient;
  private readonly projectId: string | null;
  private channels: Map<string, RealtimeChannel> = new Map();

  constructor(config: PerceoClientConfig) {
    this.supabase = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: false,
      },
    });
    this.projectId = config.projectId ?? null;
  }

  /**
   * Create a client from environment variables
   */
  static fromEnv(projectId?: string): PerceoDataClient {
    const supabaseUrl = process.env.PERCEO_SUPABASE_URL;
    const supabaseKey = process.env.PERCEO_SUPABASE_SERVICE_ROLE_KEY || process.env.PERCEO_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("PERCEO_SUPABASE_URL and PERCEO_SUPABASE_ANON_KEY (or SERVICE_ROLE_KEY) are required");
    }

    return new PerceoDataClient({
      supabaseUrl,
      supabaseKey,
      projectId,
    });
  }

  /**
   * Get the underlying Supabase client (for advanced operations)
   */
  getSupabaseClient(): SupabaseClient {
    return this.supabase;
  }

  // ==========================================================================
  // Projects
  // ==========================================================================

  async getProject(id: UUID): Promise<Project | null> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw error;
    return data as Project | null;
  }

  async getProjectByName(name: string): Promise<Project | null> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("*")
      .eq("name", name)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return data as Project | null;
  }

  async createProject(project: ProjectInsert): Promise<Project> {
    const { data, error } = await this.supabase
      .from("projects")
      .insert(project as any)
      .select()
      .single();

    if (error) throw error;
    return data as Project;
  }

  async upsertProject(project: ProjectInsert): Promise<Project> {
    const { data, error } = await this.supabase
      .from("projects")
      .upsert(project as any, { onConflict: "name" })
      .select()
      .single();

    if (error) throw error;
    return data as Project;
  }

  // ==========================================================================
  // Personas
  // ==========================================================================

  async getPersonas(projectId?: string): Promise<Persona[]> {
    const pid = projectId ?? this.projectId;
    if (!pid) throw new Error("Project ID required");

    const { data, error } = await this.supabase
      .from("personas")
      .select("*")
      .eq("project_id", pid)
      .order("name");

    if (error) throw error;
    return (data ?? []) as Persona[];
  }

  async createPersona(persona: PersonaInsert): Promise<Persona> {
    const { data, error } = await this.supabase
      .from("personas")
      .insert(persona as any)
      .select()
      .single();

    if (error) throw error;
    return data as Persona;
  }

  // ==========================================================================
  // Flows
  // ==========================================================================

  async getFlows(projectId?: string): Promise<Flow[]> {
    const pid = projectId ?? this.projectId;
    if (!pid) throw new Error("Project ID required");

    const { data, error } = await this.supabase
      .from("flows")
      .select("*")
      .eq("project_id", pid)
      .eq("is_active", true)
      .order("priority", { ascending: true })
      .order("name");

    if (error) throw error;
    return (data ?? []) as Flow[];
  }

  async getFlow(id: UUID): Promise<Flow | null> {
    const { data, error } = await this.supabase
      .from("flows")
      .select("*")
      .eq("id", id)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return data as Flow | null;
  }

  async getFlowByName(name: string, projectId?: string): Promise<Flow | null> {
    const pid = projectId ?? this.projectId;
    if (!pid) throw new Error("Project ID required");

    const { data, error } = await this.supabase
      .from("flows")
      .select("*")
      .eq("project_id", pid)
      .eq("name", name)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return data as Flow | null;
  }

  async getFlowWithSteps(id: UUID): Promise<FlowWithSteps | null> {
    const { data: flow, error: flowError } = await this.supabase
      .from("flows")
      .select("*")
      .eq("id", id)
      .single();

    if (flowError) throw flowError;
    if (!flow) return null;

    const { data: steps, error: stepsError } = await this.supabase
      .from("steps")
      .select("*")
      .eq("flow_id", id)
      .order("sequence_order");

    if (stepsError) throw stepsError;

    return { ...(flow as Flow), steps: (steps ?? []) as Step[] };
  }

  async getFlowWithMetrics(id: UUID): Promise<FlowWithMetrics | null> {
    const { data: flow, error: flowError } = await this.supabase
      .from("flows")
      .select("*")
      .eq("id", id)
      .single();

    if (flowError) throw flowError;
    if (!flow) return null;

    const { data: metrics, error: metricsError } = await this.supabase
      .from("flow_metrics")
      .select("*")
      .eq("flow_id", id)
      .single();

    if (metricsError && metricsError.code !== "PGRST116") throw metricsError;

    return { ...(flow as Flow), metrics: (metrics as FlowMetrics) ?? null };
  }

  async createFlow(flow: FlowInsert): Promise<Flow> {
    const { data, error } = await this.supabase
      .from("flows")
      .insert(flow as any)
      .select()
      .single();

    if (error) throw error;
    return data as Flow;
  }

  async updateFlow(id: UUID, updates: FlowUpdate): Promise<Flow> {
    const { data, error } = await this.supabase
      .from("flows")
      .update(updates as any)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return data as Flow;
  }

  async upsertFlow(flow: FlowInsert): Promise<Flow> {
    const { data, error } = await this.supabase
      .from("flows")
      .upsert(flow as any, { onConflict: "project_id,name" })
      .select()
      .single();

    if (error) throw error;
    return data as Flow;
  }

  async upsertFlows(flows: FlowInsert[]): Promise<Flow[]> {
    const { data, error } = await this.supabase
      .from("flows")
      .upsert(flows as any[], { onConflict: "project_id,name" })
      .select();

    if (error) throw error;
    return (data ?? []) as Flow[];
  }

  /**
   * Get flows affected by recent code changes
   */
  async getAffectedFlows(projectId?: string): Promise<Flow[]> {
    const pid = projectId ?? this.projectId;
    if (!pid) throw new Error("Project ID required");

    const { data, error } = await this.supabase
      .from("flows")
      .select("*")
      .eq("project_id", pid)
      .eq("is_active", true)
      .not("affected_by_changes", "eq", "{}")
      .order("risk_score", { ascending: false });

    if (error) throw error;
    return (data ?? []) as Flow[];
  }

  /**
   * Mark flows as affected by a code change
   */
  async markFlowsAffected(flowIds: UUID[], changeId: string, riskScoreIncrement: number = 0.1): Promise<void> {
    // Update each flow to add the change ID and increment risk score
    for (const flowId of flowIds) {
      const { data: flow } = await this.supabase
        .from("flows")
        .select("affected_by_changes, risk_score")
        .eq("id", flowId)
        .single();

      if (flow) {
        const currentChanges = (flow as any).affected_by_changes ?? [];
        const newRiskScore = Math.min(1.0, ((flow as any).risk_score ?? 0) + riskScoreIncrement);

        await this.supabase
          .from("flows")
          .update({
            affected_by_changes: [...currentChanges, changeId],
            risk_score: newRiskScore,
          } as any)
          .eq("id", flowId);
      }
    }
  }

  /**
   * Clear affected changes from flows (e.g., after tests pass)
   */
  async clearAffectedFlows(flowIds: UUID[]): Promise<void> {
    await this.supabase
      .from("flows")
      .update({
        affected_by_changes: [],
        risk_score: 0,
      } as any)
      .in("id", flowIds);
  }

  // ==========================================================================
  // Steps
  // ==========================================================================

  async getSteps(flowId: UUID): Promise<Step[]> {
    const { data, error } = await this.supabase
      .from("steps")
      .select("*")
      .eq("flow_id", flowId)
      .order("sequence_order");

    if (error) throw error;
    return (data ?? []) as Step[];
  }

  async createStep(step: StepInsert): Promise<Step> {
    const { data, error } = await this.supabase
      .from("steps")
      .insert(step as any)
      .select()
      .single();

    if (error) throw error;
    return data as Step;
  }

  async createSteps(steps: StepInsert[]): Promise<Step[]> {
    const { data, error } = await this.supabase
      .from("steps")
      .insert(steps as any[])
      .select();

    if (error) throw error;
    return (data ?? []) as Step[];
  }

  // ==========================================================================
  // Test Runs
  // ==========================================================================

  async getTestRuns(flowId: UUID, limit: number = 20): Promise<TestRun[]> {
    const { data, error } = await this.supabase
      .from("test_runs")
      .select("*")
      .eq("flow_id", flowId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data ?? []) as TestRun[];
  }

  async getRecentTestRuns(projectId?: string, limit: number = 50): Promise<TestRun[]> {
    const pid = projectId ?? this.projectId;
    if (!pid) throw new Error("Project ID required");

    const { data, error } = await this.supabase
      .from("test_runs")
      .select("*")
      .eq("project_id", pid)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data ?? []) as TestRun[];
  }

  async createTestRun(testRun: TestRunInsert): Promise<TestRun> {
    const { data, error } = await this.supabase
      .from("test_runs")
      .insert(testRun as any)
      .select()
      .single();

    if (error) throw error;
    return data as TestRun;
  }

  async updateTestRun(id: UUID, updates: TestRunUpdate): Promise<TestRun> {
    const { data, error } = await this.supabase
      .from("test_runs")
      .update(updates as any)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return data as TestRun;
  }

  // ==========================================================================
  // Insights
  // ==========================================================================

  async getInsights(projectId?: string, status?: string): Promise<Insight[]> {
    const pid = projectId ?? this.projectId;
    if (!pid) throw new Error("Project ID required");

    let query = this.supabase
      .from("insights")
      .select("*")
      .eq("project_id", pid)
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) throw error;
    return (data ?? []) as Insight[];
  }

  async getOpenInsights(projectId?: string): Promise<Insight[]> {
    return this.getInsights(projectId, "open");
  }

  async createInsight(insight: InsightInsert): Promise<Insight> {
    const { data, error } = await this.supabase
      .from("insights")
      .insert(insight as any)
      .select()
      .single();

    if (error) throw error;
    return data as Insight;
  }

  async updateInsight(id: UUID, updates: InsightUpdate): Promise<Insight> {
    const { data, error } = await this.supabase
      .from("insights")
      .update(updates as any)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return data as Insight;
  }

  // ==========================================================================
  // Code Changes
  // ==========================================================================

  async createCodeChange(change: CodeChangeInsert): Promise<CodeChange> {
    const { data, error } = await this.supabase
      .from("code_changes")
      .insert(change as any)
      .select()
      .single();

    if (error) throw error;
    return data as CodeChange;
  }

  async getCodeChange(baseSha: string, headSha: string, projectId?: string): Promise<CodeChange | null> {
    const pid = projectId ?? this.projectId;
    if (!pid) throw new Error("Project ID required");

    const { data, error } = await this.supabase
      .from("code_changes")
      .select("*")
      .eq("project_id", pid)
      .eq("base_sha", baseSha)
      .eq("head_sha", headSha)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return data as CodeChange | null;
  }

  async updateCodeChangeAnalysis(
    id: UUID,
    analysis: {
      risk_level?: string;
      risk_score?: number;
      affected_flow_ids?: UUID[];
      llm_analysis?: Record<string, unknown>;
    }
  ): Promise<CodeChange> {
    const { data, error } = await this.supabase
      .from("code_changes")
      .update({
        ...analysis,
        analyzed_at: new Date().toISOString(),
      } as any)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return data as CodeChange;
  }

  // ==========================================================================
  // Events (Realtime Event Bus)
  // ==========================================================================

  async publishEvent(event: Omit<PerceoEventInsert, "project_id"> & { project_id?: UUID }): Promise<PerceoEvent> {
    const { data, error } = await this.supabase
      .from("events")
      .insert({
        ...event,
        project_id: event.project_id ?? this.projectId ?? undefined,
      } as any)
      .select()
      .single();

    if (error) throw error;
    return data as PerceoEvent;
  }

  /**
   * Publish a flow change event
   */
  async publishFlowsAffected(
    changeId: string,
    affectedFlows: { id: UUID; name: string; riskScore: number }[],
    source: EventSource = "observer"
  ): Promise<PerceoEvent> {
    return this.publishEvent({
      type: "flows.affected",
      payload: {
        changeId,
        flows: affectedFlows,
        timestamp: Date.now(),
      },
      source,
    });
  }

  /**
   * Publish a test status event
   */
  async publishTestStatus(
    testRunId: UUID,
    flowId: UUID,
    status: string,
    source: EventSource = "coordinator"
  ): Promise<PerceoEvent> {
    return this.publishEvent({
      type: `test.${status}`,
      payload: {
        testRunId,
        flowId,
        status,
        timestamp: Date.now(),
      },
      source,
    });
  }

  // ==========================================================================
  // Predictions
  // ==========================================================================

  async createPrediction(prediction: Omit<Prediction, "id" | "created_at" | "validated_at">): Promise<Prediction> {
    const { data, error } = await this.supabase
      .from("predictions")
      .insert(prediction as any)
      .select()
      .single();

    if (error) throw error;
    return data as Prediction;
  }

  async getUnvalidatedPredictions(flowId: UUID): Promise<Prediction[]> {
    const { data, error } = await this.supabase
      .from("predictions")
      .select("*")
      .eq("flow_id", flowId)
      .is("validated_at", null)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data ?? []) as Prediction[];
  }

  // ==========================================================================
  // Flow Metrics
  // ==========================================================================

  async getFlowMetrics(flowId: UUID): Promise<FlowMetrics | null> {
    const { data, error } = await this.supabase
      .from("flow_metrics")
      .select("*")
      .eq("flow_id", flowId)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return data as FlowMetrics | null;
  }

  async upsertFlowMetrics(flowId: UUID, metrics: Partial<Omit<FlowMetrics, "id" | "flow_id">>): Promise<FlowMetrics> {
    const { data, error } = await this.supabase
      .from("flow_metrics")
      .upsert({ flow_id: flowId, ...metrics } as any, { onConflict: "flow_id" })
      .select()
      .single();

    if (error) throw error;
    return data as FlowMetrics;
  }

  // ==========================================================================
  // API Keys
  // ==========================================================================

  /**
   * Generate a new API key for a project
   * Returns the full key (only shown once) and the created key record
   */
  async createApiKey(
    projectId: UUID,
    options: {
      name: string;
      scopes: ApiKeyScope[];
      expiresAt?: Date;
      createdBy?: UUID;
    }
  ): Promise<{ key: string; keyRecord: ProjectApiKey }> {
    // Generate a secure random key
    const keyBytes = randomBytes(32);
    const key = `prc_${keyBytes.toString("base64url")}`;
    
    // Create prefix (first 8 chars after prc_)
    const keyPrefix = key.substring(0, 12); // "prc_" + 8 chars
    
    // Hash the key for storage
    const keyHash = createHash("sha256").update(key).digest("hex");
    
    const insertData: ProjectApiKeyInsert = {
      project_id: projectId,
      name: options.name,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      scopes: options.scopes,
      created_by: options.createdBy ?? null,
      expires_at: options.expiresAt?.toISOString() ?? null,
    };

    const { data, error } = await this.supabase
      .from("project_api_keys")
      .insert(insertData as any)
      .select()
      .single();

    if (error) throw error;
    
    return {
      key,
      keyRecord: data as ProjectApiKey,
    };
  }

  /**
   * Get all API keys for a project (metadata only, no hashes)
   */
  async getApiKeys(projectId?: string): Promise<Omit<ProjectApiKey, "key_hash">[]> {
    const pid = projectId ?? this.projectId;
    if (!pid) throw new Error("Project ID required");

    const { data, error } = await this.supabase
      .from("project_api_keys")
      .select("id, project_id, name, key_prefix, scopes, created_by, created_at, last_used_at, last_used_ip, expires_at, revoked_at, revoked_by, revocation_reason")
      .eq("project_id", pid)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data ?? []) as Omit<ProjectApiKey, "key_hash">[];
  }

  /**
   * Get active (non-revoked, non-expired) API keys for a project
   */
  async getActiveApiKeys(projectId?: string): Promise<Omit<ProjectApiKey, "key_hash">[]> {
    const pid = projectId ?? this.projectId;
    if (!pid) throw new Error("Project ID required");

    const { data, error } = await this.supabase
      .from("project_api_keys")
      .select("id, project_id, name, key_prefix, scopes, created_by, created_at, last_used_at, last_used_ip, expires_at, revoked_at, revoked_by, revocation_reason")
      .eq("project_id", pid)
      .is("revoked_at", null)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data ?? []) as Omit<ProjectApiKey, "key_hash">[];
  }

  /**
   * Validate an API key and return the project info if valid
   */
  async validateApiKey(key: string): Promise<{
    projectId: UUID;
    scopes: ApiKeyScope[];
    keyId: UUID;
  } | null> {
    if (!key.startsWith("prc_")) {
      return null;
    }

    const keyPrefix = key.substring(0, 12);
    const keyHash = createHash("sha256").update(key).digest("hex");

    const { data, error } = await this.supabase
      .rpc("validate_api_key", {
        p_key_prefix: keyPrefix,
        p_key_hash: keyHash,
      });

    if (error) throw error;
    if (!data || data.length === 0) return null;

    const result = data[0];
    
    // Record usage
    await this.supabase.rpc("record_api_key_usage", {
      p_key_id: result.key_id,
    });

    return {
      projectId: result.project_id,
      scopes: result.scopes,
      keyId: result.key_id,
    };
  }

  /**
   * Revoke an API key
   */
  async revokeApiKey(
    keyId: UUID,
    options?: {
      revokedBy?: UUID;
      reason?: string;
    }
  ): Promise<ProjectApiKey> {
    const { data, error } = await this.supabase
      .from("project_api_keys")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by: options?.revokedBy ?? null,
        revocation_reason: options?.reason ?? null,
      } as any)
      .eq("id", keyId)
      .select()
      .single();

    if (error) throw error;
    return data as ProjectApiKey;
  }

  /**
   * Delete an API key permanently
   */
  async deleteApiKey(keyId: UUID): Promise<void> {
    const { error } = await this.supabase
      .from("project_api_keys")
      .delete()
      .eq("id", keyId);

    if (error) throw error;
  }

  /**
   * Check if an API key has a specific scope
   */
  async hasApiKeyScope(keyId: UUID, scope: ApiKeyScope): Promise<boolean> {
    const { data, error } = await this.supabase
      .rpc("has_api_key_scope", {
        p_key_id: keyId,
        p_scope: scope,
      });

    if (error) throw error;
    return data as boolean;
  }

  // ==========================================================================
  // Realtime Subscriptions
  // ==========================================================================

  /**
   * Subscribe to flow changes (via Postgres CDC)
   */
  subscribeToFlows(
    projectId: string,
    callback: (payload: RealtimePayload<Flow>) => void
  ): RealtimeChannel {
    const channelName = `flows-${projectId}`;
    
    if (this.channels.has(channelName)) {
      return this.channels.get(channelName)!;
    }

    const channel = this.supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "flows",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          callback(payload as unknown as RealtimePayload<Flow>);
        }
      )
      .subscribe();

    this.channels.set(channelName, channel);
    return channel;
  }

  /**
   * Subscribe to test run updates
   */
  subscribeToTestRuns(
    projectId: string,
    callback: (payload: RealtimePayload<TestRun>) => void
  ): RealtimeChannel {
    const channelName = `test-runs-${projectId}`;
    
    if (this.channels.has(channelName)) {
      return this.channels.get(channelName)!;
    }

    const channel = this.supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "test_runs",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          callback(payload as unknown as RealtimePayload<TestRun>);
        }
      )
      .subscribe();

    this.channels.set(channelName, channel);
    return channel;
  }

  /**
   * Subscribe to new insights
   */
  subscribeToInsights(
    projectId: string,
    callback: (payload: RealtimePayload<Insight>) => void
  ): RealtimeChannel {
    const channelName = `insights-${projectId}`;
    
    if (this.channels.has(channelName)) {
      return this.channels.get(channelName)!;
    }

    const channel = this.supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "insights",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          callback(payload as unknown as RealtimePayload<Insight>);
        }
      )
      .subscribe();

    this.channels.set(channelName, channel);
    return channel;
  }

  /**
   * Subscribe to events (event bus)
   */
  subscribeToEvents(
    projectId: string,
    eventTypes: string[] | null,
    callback: (payload: RealtimePayload<PerceoEvent>) => void
  ): RealtimeChannel {
    const channelName = `events-${projectId}-${eventTypes?.join("-") ?? "all"}`;
    
    if (this.channels.has(channelName)) {
      return this.channels.get(channelName)!;
    }

    const channel = this.supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "events",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const event = payload.new as PerceoEvent;
          // Filter by event type if specified
          if (!eventTypes || eventTypes.includes(event.type)) {
            callback(payload as unknown as RealtimePayload<PerceoEvent>);
          }
        }
      )
      .subscribe();

    this.channels.set(channelName, channel);
    return channel;
  }

  /**
   * Broadcast ephemeral messages (not persisted)
   */
  broadcast(channelName: string, event: string, payload: unknown): void {
    const channel = this.supabase.channel(channelName);
    channel.send({
      type: "broadcast",
      event,
      payload,
    });
  }

  /**
   * Subscribe to broadcast messages
   */
  subscribeToBroadcast(
    channelName: string,
    event: string,
    callback: (payload: unknown) => void
  ): RealtimeChannel {
    const fullChannelName = `broadcast-${channelName}`;
    
    if (this.channels.has(fullChannelName)) {
      return this.channels.get(fullChannelName)!;
    }

    const channel = this.supabase
      .channel(fullChannelName)
      .on("broadcast", { event }, ({ payload }) => {
        callback(payload);
      })
      .subscribe();

    this.channels.set(fullChannelName, channel);
    return channel;
  }

  /**
   * Unsubscribe from a channel
   */
  async unsubscribe(channelName: string): Promise<void> {
    const channel = this.channels.get(channelName);
    if (channel) {
      await channel.unsubscribe();
      this.channels.delete(channelName);
    }
  }

  /**
   * Unsubscribe from all channels
   */
  async unsubscribeAll(): Promise<void> {
    for (const [name, channel] of this.channels) {
      await channel.unsubscribe();
      this.channels.delete(name);
    }
  }

  /**
   * Cleanup - call when done with the client
   */
  async cleanup(): Promise<void> {
    await this.unsubscribeAll();
  }
}
