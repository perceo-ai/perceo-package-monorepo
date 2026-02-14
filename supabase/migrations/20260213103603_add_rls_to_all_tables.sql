-- Relaxed RLS policies for development / CLI usage
-- Date: 2026-02-13
--
-- NOTE:
-- - The base schema (20260213013048_init-db.sql) already ENABLEs RLS on all tables
--   and adds project-scoped policies based on project membership.
-- - This migration adds *additional* permissive policies so that any
--   authenticated Supabase user (including the one used by the CLI)
--   can fully manage all tables. RLS policies are OR'd together, so the
--   existing stricter policies remain in place for production hardening.
--
-- Important: If you want to tighten permissions later, you can either:
-- - Drop these "Authenticated users can manage ..." policies, or
-- - Replace them with more restrictive, role-based variants.

-- ============================================================================
-- Helper predicate: is_authenticated
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_authenticated()
RETURNS boolean AS $$
BEGIN
  RETURN auth.role() = 'authenticated' OR auth.role() = 'service_role';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- PROJECTS & MEMBERSHIP
-- ============================================================================

-- Allow any authenticated user (including CLI / service role) to fully
-- manage projects. This makes it easy to bootstrap and edit projects
-- without having to first seed project_members rows.
CREATE POLICY "Authenticated users can manage projects (dev)"
  ON projects
  FOR ALL
  USING (public.is_authenticated())
  WITH CHECK (public.is_authenticated());

-- Allow full management of project_members so you can add yourself and
-- others to projects through the dashboard / CLI.
CREATE POLICY "Authenticated users can manage project members (dev)"
  ON project_members
  FOR ALL
  USING (public.is_authenticated())
  WITH CHECK (public.is_authenticated());

-- ============================================================================
-- CORE PROJECT-SCOPED TABLES
-- ============================================================================

CREATE POLICY "Authenticated users can manage personas (dev)"
  ON personas
  FOR ALL
  USING (public.is_authenticated())
  WITH CHECK (public.is_authenticated());

CREATE POLICY "Authenticated users can manage flows (dev)"
  ON flows
  FOR ALL
  USING (public.is_authenticated())
  WITH CHECK (public.is_authenticated());

CREATE POLICY "Authenticated users can manage steps (dev)"
  ON steps
  FOR ALL
  USING (public.is_authenticated())
  WITH CHECK (public.is_authenticated());

CREATE POLICY "Authenticated users can manage flow metrics (dev)"
  ON flow_metrics
  FOR ALL
  USING (public.is_authenticated())
  WITH CHECK (public.is_authenticated());

CREATE POLICY "Authenticated users can manage test runs (dev)"
  ON test_runs
  FOR ALL
  USING (public.is_authenticated())
  WITH CHECK (public.is_authenticated());

CREATE POLICY "Authenticated users can manage analytics events (dev)"
  ON analytics_events
  FOR ALL
  USING (public.is_authenticated())
  WITH CHECK (public.is_authenticated());

CREATE POLICY "Authenticated users can manage insights (dev)"
  ON insights
  FOR ALL
  USING (public.is_authenticated())
  WITH CHECK (public.is_authenticated());

CREATE POLICY "Authenticated users can manage predictions (dev)"
  ON predictions
  FOR ALL
  USING (public.is_authenticated())
  WITH CHECK (public.is_authenticated());

CREATE POLICY "Authenticated users can manage events (dev)"
  ON events
  FOR ALL
  USING (public.is_authenticated())
  WITH CHECK (public.is_authenticated());

CREATE POLICY "Authenticated users can manage code changes (dev)"
  ON code_changes
  FOR ALL
  USING (public.is_authenticated())
  WITH CHECK (public.is_authenticated());

CREATE POLICY "Authenticated users can manage analytics connections (dev)"
  ON analytics_connections
  FOR ALL
  USING (public.is_authenticated())
  WITH CHECK (public.is_authenticated());

-- ============================================================================
-- PROJECT API KEYS & AUDIT
-- ============================================================================

CREATE POLICY "Authenticated users can manage project API keys (dev)"
  ON project_api_keys
  FOR ALL
  USING (public.is_authenticated())
  WITH CHECK (public.is_authenticated());

CREATE POLICY "Authenticated users can manage project API key audit (dev)"
  ON project_api_key_audit
  FOR ALL
  USING (public.is_authenticated())
  WITH CHECK (public.is_authenticated());

