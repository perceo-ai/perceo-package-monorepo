-- Enforce project membership: only members can access project data
-- Date: 2026-02-14
--
-- 1. When a project is created, the creating user is added as owner.
-- 2. Drop permissive "dev" policies so RLS restricts access to project members only.
--    (Base policies in 20260213013048_init-db.sql use is_project_member / is_project_admin.)

-- ============================================================================
-- Trigger: add project creator as owner in project_members
-- ============================================================================

CREATE OR REPLACE FUNCTION public.add_creator_as_project_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO project_members (project_id, user_id, role)
    VALUES (NEW.id, auth.uid(), 'owner')
    ON CONFLICT (project_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS after_project_insert_add_owner ON projects;
CREATE TRIGGER after_project_insert_add_owner
  AFTER INSERT ON projects
  FOR EACH ROW
  EXECUTE FUNCTION add_creator_as_project_owner();

-- ============================================================================
-- Drop permissive dev policies (membership-based RLS from init-db then applies)
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can manage projects (dev)" ON projects;
DROP POLICY IF EXISTS "Authenticated users can manage project members (dev)" ON project_members;
DROP POLICY IF EXISTS "Authenticated users can manage personas (dev)" ON personas;
DROP POLICY IF EXISTS "Authenticated users can manage flows (dev)" ON flows;
DROP POLICY IF EXISTS "Authenticated users can manage steps (dev)" ON steps;
DROP POLICY IF EXISTS "Authenticated users can manage flow metrics (dev)" ON flow_metrics;
DROP POLICY IF EXISTS "Authenticated users can manage test runs (dev)" ON test_runs;
DROP POLICY IF EXISTS "Authenticated users can manage analytics events (dev)" ON analytics_events;
DROP POLICY IF EXISTS "Authenticated users can manage insights (dev)" ON insights;
DROP POLICY IF EXISTS "Authenticated users can manage predictions (dev)" ON predictions;
DROP POLICY IF EXISTS "Authenticated users can manage events (dev)" ON events;
DROP POLICY IF EXISTS "Authenticated users can manage code changes (dev)" ON code_changes;
DROP POLICY IF EXISTS "Authenticated users can manage analytics connections (dev)" ON analytics_connections;
DROP POLICY IF EXISTS "Authenticated users can manage project API keys (dev)" ON project_api_keys;
DROP POLICY IF EXISTS "Authenticated users can manage project API key audit (dev)" ON project_api_key_audit;

-- ============================================================================
-- Base schema only had SELECT on steps and flow_metrics; add admin manage policies
-- ============================================================================

CREATE POLICY "Project admins can manage steps"
  ON steps FOR ALL
  USING (
    EXISTS (SELECT 1 FROM flows f WHERE f.id = steps.flow_id AND public.is_project_admin(f.project_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM flows f WHERE f.id = steps.flow_id AND public.is_project_admin(f.project_id))
  );

CREATE POLICY "Project admins can manage flow metrics"
  ON flow_metrics FOR ALL
  USING (
    EXISTS (SELECT 1 FROM flows f WHERE f.id = flow_metrics.flow_id AND public.is_project_admin(f.project_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM flows f WHERE f.id = flow_metrics.flow_id AND public.is_project_admin(f.project_id))
  );

-- test_runs: base has SELECT + INSERT for members; add UPDATE for members (e.g. status updates)
CREATE POLICY "Project members can update test runs"
  ON test_runs FOR UPDATE
  USING (public.is_project_member(project_id));

-- code_changes: base had only SELECT; allow members to insert (e.g. from CLI/worker)
CREATE POLICY "Project members can insert code changes"
  ON code_changes FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

-- ============================================================================
-- Note: Project INSERT remains allowed for authenticated users via init-db policy.
-- After insert, the trigger adds the creator as owner so they can SELECT/UPDATE.
-- ============================================================================
