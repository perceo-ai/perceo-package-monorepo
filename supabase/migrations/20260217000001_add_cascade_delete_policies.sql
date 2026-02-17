-- Add DELETE policies for project deletion cascade (child tables)
-- Date: 2026-02-17
--
-- When deleting a project, CASCADE propagates to child tables. RLS still applies
-- to those cascaded deletes - without DELETE policies, the cascade fails.
-- project_api_key_audit cascades from project_api_keys.

CREATE POLICY "Project admins can delete test runs"
  ON test_runs FOR DELETE
  USING (public.is_project_admin(project_id));

CREATE POLICY "Project admins can delete insights"
  ON insights FOR DELETE
  USING (public.is_project_admin(project_id));

CREATE POLICY "Project admins can delete predictions"
  ON predictions FOR DELETE
  USING (public.is_project_admin(project_id));

CREATE POLICY "Project admins can delete events"
  ON events FOR DELETE
  USING (public.is_project_admin(project_id));

CREATE POLICY "Project admins can delete code changes"
  ON code_changes FOR DELETE
  USING (public.is_project_admin(project_id));

CREATE POLICY "Project admins can delete API key audit logs"
  ON project_api_key_audit FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM project_api_keys pak
      WHERE pak.id = project_api_key_audit.key_id
      AND public.is_project_admin(pak.project_id)
    )
  );
