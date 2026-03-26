-- Computer-use desktop execution config, telemetry stream, and screenshot storage.
-- Aligns with apps/computer-use-agent and PRD flow_computer_use.

-- ============================================================================
-- flow_computer_use (1:1 with flows)
-- ============================================================================

CREATE TABLE flow_computer_use (
  flow_id uuid PRIMARY KEY REFERENCES flows(id) ON DELETE CASCADE,

  goal text NOT NULL,
  success_criteria text NOT NULL,
  timeout_seconds int NOT NULL DEFAULT 300 CHECK (timeout_seconds > 0),

  vm_type text NOT NULL CHECK (vm_type IN ('windows', 'linux', 'macos')),
  vm_snapshot_name text NOT NULL,

  app_source_type text NOT NULL CHECK (app_source_type IN ('installed', 'repo')),

  app_setup_script_path text,

  repo_url text,
  repo_branch text,
  build_command text,
  start_command text,
  ready_wait_spec text NOT NULL DEFAULT 'delay:0',
  env_secret_names text[] NOT NULL DEFAULT '{}',
  runtime_snapshot_name text,
  cache_strategy text NOT NULL DEFAULT 'none'
    CHECK (cache_strategy IN ('none', 'deps-only', 'full')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT flow_computer_use_installed_shape CHECK (
    app_source_type <> 'installed'
    OR (
      repo_url IS NULL
      AND repo_branch IS NULL
      AND build_command IS NULL
      AND start_command IS NULL
      AND runtime_snapshot_name IS NULL
    )
  ),
  CONSTRAINT flow_computer_use_repo_shape CHECK (
    app_source_type <> 'repo'
    OR (
      repo_url IS NOT NULL
      AND build_command IS NOT NULL
      AND start_command IS NOT NULL
      AND runtime_snapshot_name IS NOT NULL
    )
  )
);

CREATE INDEX idx_flow_computer_use_vm_type ON flow_computer_use (vm_type);

COMMENT ON TABLE flow_computer_use IS '1:1 desktop (computer-use) execution config; join to flows for shared metadata.';
COMMENT ON COLUMN flow_computer_use.ready_wait_spec IS 'Coordinator readiness probe: port:3000 | stdout:Ready | file:/tmp/ready | delay:N';
COMMENT ON COLUMN flow_computer_use.env_secret_names IS 'Names only; values from Temporal secrets / project secrets at run time.';

CREATE TRIGGER update_flow_computer_use_updated_at
  BEFORE UPDATE ON flow_computer_use
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE flow_computer_use ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view flow computer use"
  ON flow_computer_use FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM flows f
      WHERE f.id = flow_computer_use.flow_id
      AND public.is_project_member(f.project_id)
    )
  );

CREATE POLICY "Project admins can manage flow computer use"
  ON flow_computer_use FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM flows f
      WHERE f.id = flow_computer_use.flow_id
      AND public.is_project_admin(f.project_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM flows f
      WHERE f.id = flow_computer_use.flow_id
      AND public.is_project_admin(f.project_id)
    )
  );

-- ============================================================================
-- telemetry_events (optional realtime per-step stream)
-- ============================================================================

CREATE TABLE telemetry_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id uuid REFERENCES test_runs(id) ON DELETE CASCADE,
  flow_id uuid REFERENCES flows(id) ON DELETE SET NULL,
  vm_id text NOT NULL DEFAULT '',
  step_index integer NOT NULL,
  action_type text NOT NULL,
  success boolean,
  screenshot_url text,
  coordinator_event text,
  payload jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_telemetry_events_run ON telemetry_events (test_run_id, step_index);
CREATE INDEX idx_telemetry_events_flow ON telemetry_events (flow_id, created_at DESC);

COMMENT ON TABLE telemetry_events IS 'Fine-grained computer-use step events for Realtime dashboards.';

ALTER TABLE telemetry_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view telemetry events"
  ON telemetry_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM test_runs tr
      WHERE tr.id = telemetry_events.test_run_id
      AND public.is_project_member(tr.project_id)
    )
  );

-- INSERT/UPDATE: service role (worker) bypasses RLS; no broad authenticated INSERT.

ALTER PUBLICATION supabase_realtime ADD TABLE telemetry_events;

-- ============================================================================
-- Storage bucket for screenshots / replay assets (private)
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'computer-use',
  'computer-use',
  false,
  52428800,
  ARRAY['image/jpeg', 'image/png', 'video/mp4']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Object path layout: {project_id}/{test_run_id}/…
CREATE POLICY "Project members read computer-use files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'computer-use'
    AND EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.user_id = auth.uid()
        AND (string_to_array(name, '/'))[1] = pm.project_id::text
    )
  );

CREATE POLICY "Project admins upload computer-use files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'computer-use'
    AND EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.user_id = auth.uid()
        AND pm.role IN ('owner', 'admin')
        AND (string_to_array(name, '/'))[1] = pm.project_id::text
    )
  );

CREATE POLICY "Project admins update computer-use files"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'computer-use'
    AND EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.user_id = auth.uid()
        AND pm.role IN ('owner', 'admin')
        AND (string_to_array(name, '/'))[1] = pm.project_id::text
    )
  );

CREATE POLICY "Project admins delete computer-use files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'computer-use'
    AND EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.user_id = auth.uid()
        AND pm.role IN ('owner', 'admin')
        AND (string_to_array(name, '/'))[1] = pm.project_id::text
    )
  );
