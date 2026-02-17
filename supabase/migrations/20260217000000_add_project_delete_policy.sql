-- Add missing DELETE policy for projects
-- Date: 2026-02-17
--
-- The projects table had SELECT, UPDATE, INSERT policies but no DELETE policy.
-- Without it, deleteProject() returned success but RLS silently affected 0 rows.

CREATE POLICY "Project admins can delete projects"
  ON projects FOR DELETE
  USING (public.is_project_admin(id));
