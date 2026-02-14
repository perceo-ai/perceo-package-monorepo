-- Perceo Database Schema
-- Version: 2.0
-- Date: February 13, 2026
-- Based on: docs/cli_architecture.md

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- PROJECTS (Multi-tenancy)
-- ============================================================================

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  framework text, -- 'nextjs', 'react', 'vue', 'angular', 'svelte', etc.
  
  -- Project configuration stored as JSONB
  config jsonb DEFAULT '{}',
  
  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE(name)
);

-- Index for project lookup
CREATE INDEX idx_projects_name ON projects(name);

-- ============================================================================
-- PROJECT MEMBERS (via Supabase Auth)
-- ============================================================================

CREATE TABLE project_members (
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  
  created_at timestamptz DEFAULT now(),
  
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX idx_project_members_user ON project_members(user_id);

-- ============================================================================
-- PERSONAS (User personas for flow testing)
-- ============================================================================

CREATE TABLE personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  
  -- Persona behaviors and attributes as JSONB
  -- Example: {"patience": "low", "techSavvy": true, "preferredDevice": "mobile"}
  behaviors jsonb DEFAULT '{}',
  
  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE(project_id, name)
);

CREATE INDEX idx_personas_project ON personas(project_id);

-- ============================================================================
-- FLOWS (User flow definitions with graph data)
-- ============================================================================

CREATE TABLE flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  persona_id uuid REFERENCES personas(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  priority text CHECK (priority IN ('critical', 'high', 'medium', 'low')) DEFAULT 'medium',
  
  -- Entry point for the flow (e.g., URL path, component)
  entry_point text,
  
  -- Graph structure stored as JSONB for complex relationships
  -- Can include: nodes, edges, branching logic, conditions
  graph_data jsonb DEFAULT '{}',
  
  -- Observer data - tracking which code changes affect this flow
  affected_by_changes text[] DEFAULT '{}',
  risk_score float DEFAULT 0.0 CHECK (risk_score >= 0 AND risk_score <= 1),
  
  -- Analyzer data
  coverage_score float CHECK (coverage_score >= 0 AND coverage_score <= 1),
  
  -- Status
  is_active boolean DEFAULT true,
  
  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE(project_id, name)
);

CREATE INDEX idx_flows_project ON flows(project_id);
CREATE INDEX idx_flows_priority ON flows(priority);
CREATE INDEX idx_flows_persona ON flows(persona_id);
CREATE INDEX idx_flows_active ON flows(is_active) WHERE is_active = true;

-- ============================================================================
-- STEPS (Ordered sequence of actions per flow)
-- ============================================================================

CREATE TABLE steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  sequence_order int NOT NULL,
  name text NOT NULL,
  
  -- Actions to perform in this step
  -- Example: [{"type": "click", "target": "button#submit"}, {"type": "fill", "target": "input#email", "value": "test@example.com"}]
  actions jsonb DEFAULT '[]',
  
  -- Expected state after completing actions
  -- Example: {"url": "/dashboard", "visible": ["Welcome message"], "hidden": ["Login form"]}
  expected_state jsonb DEFAULT '{}',
  
  -- Step configuration
  timeout_ms int DEFAULT 5000,
  retry_count int DEFAULT 3,
  
  -- Optional reference to next step (for non-linear flows)
  next_step_id uuid REFERENCES steps(id) ON DELETE SET NULL,
  
  -- Conditional branching
  -- Example: {"condition": "user.isLoggedIn", "trueStepId": "uuid1", "falseStepId": "uuid2"}
  branch_config jsonb,
  
  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE(flow_id, sequence_order)
);

CREATE INDEX idx_steps_flow_order ON steps(flow_id, sequence_order);

-- ============================================================================
-- FLOW METRICS (Synthetic + Production metrics)
-- ============================================================================

CREATE TABLE flow_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  
  -- Synthetic metrics (from automated tests)
  synthetic_success_rate float CHECK (synthetic_success_rate >= 0 AND synthetic_success_rate <= 1),
  synthetic_avg_duration_ms int,
  synthetic_p50_duration_ms int,
  synthetic_p95_duration_ms int,
  synthetic_last_run timestamptz,
  synthetic_run_count int DEFAULT 0,
  
  -- Production metrics (from analytics)
  prod_success_rate float CHECK (prod_success_rate >= 0 AND prod_success_rate <= 1),
  prod_daily_users int,
  prod_weekly_users int,
  prod_avg_duration_ms int,
  prod_top_exit_step text,
  prod_conversion_rate float CHECK (prod_conversion_rate >= 0 AND prod_conversion_rate <= 1),
  
  -- Device and cohort breakdowns
  prod_device_breakdown jsonb DEFAULT '{}',
  -- Example: {"mobile": 0.45, "desktop": 0.50, "tablet": 0.05}
  
  prod_cohort_performance jsonb DEFAULT '{}',
  -- Example: {"new_users": {"success_rate": 0.72}, "returning": {"success_rate": 0.89}}
  
  prod_last_updated timestamptz,
  
  -- Gap analysis between synthetic and production
  gap_score float, -- abs(synthetic_success_rate - prod_success_rate)
  
  -- Metadata
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE(flow_id)
);

CREATE INDEX idx_flow_metrics_flow ON flow_metrics(flow_id);
CREATE INDEX idx_flow_metrics_gap ON flow_metrics(gap_score DESC) WHERE gap_score IS NOT NULL;

-- ============================================================================
-- TEST RUNS (Test execution results)
-- ============================================================================

CREATE TABLE test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid REFERENCES flows(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  
  -- Execution status
  status text NOT NULL CHECK (status IN ('pending', 'running', 'passed', 'failed', 'error', 'skipped')),
  duration_ms int,
  
  -- Error information
  error_message text,
  error_stack text,
  failed_step_id uuid REFERENCES steps(id) ON DELETE SET NULL,
  
  -- Artifacts (stored in Supabase Storage)
  screenshots jsonb DEFAULT '[]', -- Array of storage URLs
  video_url text,
  logs jsonb DEFAULT '[]',
  
  -- Context - what triggered this test
  triggered_by text CHECK (triggered_by IN ('pr', 'watch', 'manual', 'schedule', 'ci')),
  pr_number int,
  commit_sha text,
  branch_name text,
  
  -- Agent information
  agent_id text,
  agent_type text, -- 'playwright', 'computer-use', 'hybrid'
  
  -- Metadata
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX idx_test_runs_flow ON test_runs(flow_id, created_at DESC);
CREATE INDEX idx_test_runs_project ON test_runs(project_id, created_at DESC);
CREATE INDEX idx_test_runs_status ON test_runs(status, created_at DESC);
CREATE INDEX idx_test_runs_pr ON test_runs(pr_number) WHERE pr_number IS NOT NULL;
CREATE INDEX idx_test_runs_commit ON test_runs(commit_sha) WHERE commit_sha IS NOT NULL;

-- ============================================================================
-- ANALYTICS EVENTS (Time-series, partitioned by month)
-- ============================================================================

CREATE TABLE analytics_events (
  id uuid DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  
  -- Event identification
  event_type text NOT NULL,
  event_name text,
  
  -- User and session tracking
  user_id text,
  session_id text,
  anonymous_id text,
  
  -- Flow matching (computed by sequence alignment)
  flow_id uuid,
  flow_step text,
  flow_confidence float CHECK (flow_confidence >= 0 AND flow_confidence <= 1),
  
  -- Event context
  url text,
  page_path text,
  referrer text,
  
  -- Device information
  device_type text, -- 'mobile', 'desktop', 'tablet'
  browser text,
  os text,
  screen_resolution text,
  
  -- Additional event data
  metadata jsonb DEFAULT '{}',
  
  -- Provider source
  provider text, -- 'ga4', 'mixpanel', 'amplitude', 'custom'
  provider_event_id text,
  
  -- Timestamp (partition key)
  created_at timestamptz NOT NULL DEFAULT now(),
  
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Create partitions for current and next months
CREATE TABLE analytics_events_2026_02 PARTITION OF analytics_events
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE TABLE analytics_events_2026_03 PARTITION OF analytics_events
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

CREATE TABLE analytics_events_2026_04 PARTITION OF analytics_events
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

-- Indexes on partitioned table
CREATE INDEX idx_analytics_events_project ON analytics_events(project_id, created_at DESC);
CREATE INDEX idx_analytics_events_flow ON analytics_events(flow_id, created_at DESC);
CREATE INDEX idx_analytics_events_session ON analytics_events(session_id, created_at DESC);
CREATE INDEX idx_analytics_events_user ON analytics_events(user_id, created_at DESC) WHERE user_id IS NOT NULL;

-- ============================================================================
-- INSIGHTS (Generated by Analyzer Engine)
-- ============================================================================

CREATE TABLE insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  flow_id uuid REFERENCES flows(id) ON DELETE SET NULL,
  
  -- Insight classification
  type text NOT NULL CHECK (type IN ('discrepancy', 'coverage-gap', 'ux-issue', 'prediction', 'performance', 'regression')),
  severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  
  -- Insight content
  title text NOT NULL,
  message text NOT NULL,
  suggested_action text,
  
  -- Supporting data
  evidence jsonb DEFAULT '{}',
  -- Example: {"synthetic_rate": 0.95, "prod_rate": 0.68, "samples": 1500}
  
  -- Revenue impact estimation
  revenue_impact jsonb,
  -- Example: {"estimated_monthly_loss": 15000, "confidence": 0.75, "affected_users": 1200}
  
  -- Status tracking
  status text DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'in_progress', 'resolved', 'dismissed', 'false_positive')),
  
  -- Resolution
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_notes text,
  
  -- Metadata
  created_at timestamptz DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz
);

CREATE INDEX idx_insights_project ON insights(project_id, created_at DESC);
CREATE INDEX idx_insights_flow ON insights(flow_id, created_at DESC);
CREATE INDEX idx_insights_status ON insights(status, severity);
CREATE INDEX idx_insights_type ON insights(type, severity);
CREATE INDEX idx_insights_open ON insights(project_id, severity) WHERE status = 'open';

-- ============================================================================
-- PREDICTIONS (ML-based failure predictions)
-- ============================================================================

CREATE TABLE predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  flow_id uuid NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  
  -- PR/commit context
  pr_number int,
  commit_sha text,
  branch_name text,
  
  -- Prediction details
  probability float NOT NULL CHECK (probability >= 0 AND probability <= 1),
  confidence float NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reasoning text,
  
  -- Prediction method
  based_on text CHECK (based_on IN ('ml-model', 'heuristic', 'pattern', 'historical')),
  model_version text,
  
  -- Features used for prediction
  features jsonb DEFAULT '{}',
  -- Example: {"files_changed": 15, "lines_added": 250, "high_risk_paths": ["auth/", "payment/"]}
  
  -- Outcome (filled in after test runs)
  actual_result text CHECK (actual_result IN ('passed', 'failed', 'error', 'skipped')),
  prediction_correct boolean,
  
  -- Metadata
  created_at timestamptz DEFAULT now(),
  validated_at timestamptz
);

CREATE INDEX idx_predictions_project ON predictions(project_id, created_at DESC);
CREATE INDEX idx_predictions_flow ON predictions(flow_id, created_at DESC);
CREATE INDEX idx_predictions_pr ON predictions(pr_number) WHERE pr_number IS NOT NULL;
CREATE INDEX idx_predictions_commit ON predictions(commit_sha) WHERE commit_sha IS NOT NULL;
CREATE INDEX idx_predictions_unvalidated ON predictions(created_at DESC) WHERE validated_at IS NULL;

-- ============================================================================
-- EVENTS (Realtime event bus - replaces Redis pub/sub)
-- ============================================================================

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  
  -- Event type (e.g., 'flows.affected', 'test.started', 'insight.created')
  type text NOT NULL,
  
  -- Event payload
  payload jsonb NOT NULL DEFAULT '{}',
  
  -- Source engine
  source text CHECK (source IN ('observer', 'coordinator', 'analyzer', 'analytics', 'cli', 'dashboard')),
  
  -- Processing status
  processed boolean DEFAULT false,
  processed_at timestamptz,
  
  -- Metadata
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_events_project_type ON events(project_id, type, created_at DESC);
CREATE INDEX idx_events_unprocessed ON events(created_at DESC) WHERE processed = false;

-- Auto-cleanup old events (keep last 7 days)
-- This can be done via a scheduled function or Supabase Edge Function

-- ============================================================================
-- CODE CHANGES (Track code changes for analysis)
-- ============================================================================

CREATE TABLE code_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  
  -- Git context
  base_sha text NOT NULL,
  head_sha text NOT NULL,
  branch_name text,
  pr_number int,
  
  -- Changed files
  files jsonb NOT NULL DEFAULT '[]',
  -- Example: [{"path": "src/auth/login.ts", "status": "modified", "additions": 25, "deletions": 10}]
  
  -- Analysis results
  risk_level text CHECK (risk_level IN ('critical', 'high', 'medium', 'low')),
  risk_score float CHECK (risk_score >= 0 AND risk_score <= 1),
  affected_flow_ids uuid[] DEFAULT '{}',
  
  -- LLM analysis (if enabled)
  llm_analysis jsonb,
  -- Example: {"summary": "Auth flow changes", "impacted_areas": ["login", "session"], "recommendations": [...]}
  
  -- Metadata
  created_at timestamptz DEFAULT now(),
  analyzed_at timestamptz
);

CREATE INDEX idx_code_changes_project ON code_changes(project_id, created_at DESC);
CREATE INDEX idx_code_changes_commits ON code_changes(base_sha, head_sha);
CREATE INDEX idx_code_changes_pr ON code_changes(pr_number) WHERE pr_number IS NOT NULL;

-- ============================================================================
-- ANALYTICS CONNECTIONS (Connected analytics providers)
-- ============================================================================

CREATE TABLE analytics_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  
  -- Provider info
  provider text NOT NULL, -- 'ga4', 'mixpanel', 'amplitude', 'posthog', 'custom'
  provider_account_id text,
  
  -- Connection config (encrypted credentials stored separately)
  config jsonb DEFAULT '{}',
  
  -- Sync status
  last_sync_at timestamptz,
  last_sync_status text CHECK (last_sync_status IN ('success', 'failed', 'partial')),
  last_sync_error text,
  events_synced_count int DEFAULT 0,
  
  -- Sync configuration
  sync_interval_seconds int DEFAULT 300, -- 5 minutes default
  sync_enabled boolean DEFAULT true,
  
  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE(project_id, provider)
);

CREATE INDEX idx_analytics_connections_project ON analytics_connections(project_id);
CREATE INDEX idx_analytics_connections_sync ON analytics_connections(last_sync_at) WHERE sync_enabled = true;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE code_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_connections ENABLE ROW LEVEL SECURITY;

-- Helper function to check project membership
-- NOTE: Defined in the public schema because Supabase manages the auth schema
CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = p_project_id
    AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to check project admin/owner
-- NOTE: Defined in the public schema because Supabase manages the auth schema
CREATE OR REPLACE FUNCTION public.is_project_admin(p_project_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = p_project_id
    AND user_id = auth.uid()
    AND role IN ('owner', 'admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Projects policies
CREATE POLICY "Users can view projects they're members of"
  ON projects FOR SELECT
  USING (public.is_project_member(id));

CREATE POLICY "Project admins can update projects"
  ON projects FOR UPDATE
  USING (public.is_project_admin(id));

CREATE POLICY "Authenticated users can create projects"
  ON projects FOR INSERT
  -- Allow backend services and API-key based flows to create projects.
  -- Higher-level APIs are responsible for enforcing who can create projects.
  WITH CHECK (true);

-- Project members policies
CREATE POLICY "Users can view members of their projects"
  ON project_members FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project admins can manage members"
  ON project_members FOR ALL
  USING (public.is_project_admin(project_id));

-- Generic project-scoped policies (for most tables)
CREATE POLICY "Project members can view personas"
  ON personas FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project admins can manage personas"
  ON personas FOR ALL
  USING (public.is_project_admin(project_id));

CREATE POLICY "Project members can view flows"
  ON flows FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project admins can manage flows"
  ON flows FOR ALL
  USING (public.is_project_admin(project_id));

CREATE POLICY "Project members can view steps"
  ON steps FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM flows WHERE flows.id = steps.flow_id AND public.is_project_member(flows.project_id)
  ));

CREATE POLICY "Project members can view flow metrics"
  ON flow_metrics FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM flows WHERE flows.id = flow_metrics.flow_id AND public.is_project_member(flows.project_id)
  ));

CREATE POLICY "Project members can view test runs"
  ON test_runs FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can insert test runs"
  ON test_runs FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY "Project members can view analytics events"
  ON analytics_events FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can view insights"
  ON insights FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project admins can manage insights"
  ON insights FOR UPDATE
  USING (public.is_project_admin(project_id));

CREATE POLICY "Project members can view predictions"
  ON predictions FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can view events"
  ON events FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can insert events"
  ON events FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY "Project members can view code changes"
  ON code_changes FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can view analytics connections"
  ON analytics_connections FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project admins can manage analytics connections"
  ON analytics_connections FOR ALL
  USING (public.is_project_admin(project_id));

-- ============================================================================
-- REALTIME SUBSCRIPTIONS
-- ============================================================================

-- Enable realtime for tables that need live updates
ALTER PUBLICATION supabase_realtime ADD TABLE events;
ALTER PUBLICATION supabase_realtime ADD TABLE test_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE insights;
ALTER PUBLICATION supabase_realtime ADD TABLE flows;

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_personas_updated_at
  BEFORE UPDATE ON personas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_flows_updated_at
  BEFORE UPDATE ON flows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_steps_updated_at
  BEFORE UPDATE ON steps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_flow_metrics_updated_at
  BEFORE UPDATE ON flow_metrics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_analytics_connections_updated_at
  BEFORE UPDATE ON analytics_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STORAGE BUCKETS (for screenshots, videos, reports)
-- ============================================================================

-- Note: These are created via Supabase Dashboard or API, not SQL
-- Buckets to create:
-- - screenshots (public: false) - Agent screenshots during test runs
-- - videos (public: false) - Test recording videos
-- - reports (public: false) - Generated PDF/HTML reports

-- ============================================================================
-- INDEXES FOR COMMON QUERIES
-- ============================================================================

-- Find flows affected by recent changes
CREATE INDEX idx_flows_affected_gin ON flows USING GIN (affected_by_changes);

-- Find high-risk flows
CREATE INDEX idx_flows_risk ON flows(risk_score DESC) WHERE risk_score > 0.5;

-- Find flows with coverage gaps
CREATE INDEX idx_flow_metrics_coverage_gap ON flow_metrics(gap_score DESC) WHERE gap_score > 0.1;

-- Recent insights by severity
CREATE INDEX idx_insights_recent_critical ON insights(created_at DESC) WHERE severity = 'critical' AND status = 'open';

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to calculate gap score when metrics are updated
CREATE OR REPLACE FUNCTION calculate_gap_score()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.synthetic_success_rate IS NOT NULL AND NEW.prod_success_rate IS NOT NULL THEN
    NEW.gap_score = ABS(NEW.synthetic_success_rate - NEW.prod_success_rate);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_flow_metrics_gap
  BEFORE INSERT OR UPDATE ON flow_metrics
  FOR EACH ROW EXECUTE FUNCTION calculate_gap_score();

-- Function to update flow risk score when code changes affect it
CREATE OR REPLACE FUNCTION update_flow_risk_on_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Update affected flows' risk scores
  UPDATE flows
  SET 
    affected_by_changes = array_append(affected_by_changes, NEW.id::text),
    risk_score = LEAST(1.0, risk_score + NEW.risk_score * 0.5)
  WHERE id = ANY(NEW.affected_flow_ids);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_flows_on_code_change
  AFTER INSERT ON code_changes
  FOR EACH ROW
  WHEN (NEW.affected_flow_ids IS NOT NULL AND array_length(NEW.affected_flow_ids, 1) > 0)
  EXECUTE FUNCTION update_flow_risk_on_change();

-- Function to validate prediction after test run
CREATE OR REPLACE FUNCTION validate_prediction_on_test_complete()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process when a test run completes
  IF NEW.status IN ('passed', 'failed', 'error') AND OLD.status = 'running' THEN
    -- Find unvalidated predictions for this flow and commit
    UPDATE predictions
    SET 
      actual_result = NEW.status,
      prediction_correct = (
        (probability > 0.5 AND NEW.status = 'failed') OR
        (probability <= 0.5 AND NEW.status = 'passed')
      ),
      validated_at = now()
    WHERE 
      flow_id = NEW.flow_id 
      AND commit_sha = NEW.commit_sha
      AND validated_at IS NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validate_predictions_on_test
  AFTER UPDATE ON test_runs
  FOR EACH ROW EXECUTE FUNCTION validate_prediction_on_test_complete();

