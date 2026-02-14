-- RPC to create a project and add the current user as owner in one transaction.
-- Avoids trigger/RLS issues when the trigger runs in a context where the definer
-- cannot insert into project_members (e.g. some Supabase setups).

CREATE OR REPLACE FUNCTION public.create_project_with_owner(
  p_name text,
  p_framework text DEFAULT NULL,
  p_config jsonb DEFAULT '{}',
  p_git_remote_url text DEFAULT NULL
)
RETURNS SETOF projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_project projects%ROWTYPE;
BEGIN
  INSERT INTO projects (name, framework, config, git_remote_url)
  VALUES (p_name, p_framework, COALESCE(p_config, '{}'), p_git_remote_url)
  RETURNING * INTO new_project;

  IF auth.uid() IS NOT NULL THEN
    INSERT INTO project_members (project_id, user_id, role)
    VALUES (new_project.id, auth.uid(), 'owner')
    ON CONFLICT (project_id, user_id) DO NOTHING;
  END IF;

  RETURN NEXT new_project;
  RETURN;
END;
$$;

-- Allow authenticated users to call this (they can only create; RLS still applies to SELECT/UPDATE)
GRANT EXECUTE ON FUNCTION public.create_project_with_owner(text, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_with_owner(text, text, jsonb, text) TO service_role;
