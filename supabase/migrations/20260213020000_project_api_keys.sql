-- Project API Keys for CI/CD Authentication
-- Version: 1.0
-- Date: February 13, 2026

-- ============================================================================
-- PROJECT API KEYS (for GitHub Actions and CI/CD)
-- ============================================================================

CREATE TABLE project_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  
  -- Key identification
  name text NOT NULL,
  key_hash text NOT NULL,  -- bcrypt hash of the actual key
  key_prefix text NOT NULL, -- First 8 chars for display (e.g., "prc_abc1...")
  
  -- Permissions
  scopes text[] NOT NULL DEFAULT '{}',
  -- Available scopes:
  -- 'ci:analyze' - Run perceo ci analyze
  -- 'ci:test' - Run perceo ci test
  -- 'flows:read' - Read flows
  -- 'flows:write' - Create/update flows
  -- 'insights:read' - Read insights
  -- 'events:publish' - Publish events
  
  -- Audit
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  last_used_at timestamptz,
  last_used_ip text,
  
  -- Expiration and revocation
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revocation_reason text,
  
  UNIQUE(project_id, name)
);

-- Indexes
CREATE INDEX idx_project_api_keys_project ON project_api_keys(project_id);
CREATE INDEX idx_project_api_keys_prefix ON project_api_keys(key_prefix);
CREATE INDEX idx_project_api_keys_active ON project_api_keys(project_id) 
  WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now());

-- Enable RLS
ALTER TABLE project_api_keys ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Project members can view API keys (metadata only)"
  ON project_api_keys FOR SELECT
  USING (auth.is_project_member(project_id));

CREATE POLICY "Project admins can manage API keys"
  ON project_api_keys FOR ALL
  USING (auth.is_project_admin(project_id));

-- ============================================================================
-- API KEY VALIDATION FUNCTION
-- ============================================================================

-- Function to validate an API key and return the project_id if valid
-- This is called from the API/CLI when authenticating with an API key
CREATE OR REPLACE FUNCTION validate_api_key(p_key_prefix text, p_key_hash text)
RETURNS TABLE (
  project_id uuid,
  scopes text[],
  key_id uuid
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pak.project_id,
    pak.scopes,
    pak.id as key_id
  FROM project_api_keys pak
  WHERE pak.key_prefix = p_key_prefix
    AND pak.key_hash = p_key_hash
    AND pak.revoked_at IS NULL
    AND (pak.expires_at IS NULL OR pak.expires_at > now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to record API key usage
CREATE OR REPLACE FUNCTION record_api_key_usage(p_key_id uuid, p_ip text DEFAULT NULL)
RETURNS void AS $$
BEGIN
  UPDATE project_api_keys
  SET 
    last_used_at = now(),
    last_used_ip = COALESCE(p_ip, last_used_ip)
  WHERE id = p_key_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- API KEY AUDIT LOG (optional - tracks key operations)
-- ============================================================================

CREATE TABLE project_api_key_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id uuid NOT NULL REFERENCES project_api_keys(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created', 'used', 'revoked', 'expired')),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ip_address text,
  user_agent text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_api_key_audit_key ON project_api_key_audit(key_id, created_at DESC);
CREATE INDEX idx_api_key_audit_action ON project_api_key_audit(action, created_at DESC);

-- Enable RLS
ALTER TABLE project_api_key_audit ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Project admins can view API key audit logs"
  ON project_api_key_audit FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM project_api_keys pak
    WHERE pak.id = project_api_key_audit.key_id
    AND auth.is_project_admin(pak.project_id)
  ));

-- ============================================================================
-- HELPER FUNCTION: Check API key scope
-- ============================================================================

CREATE OR REPLACE FUNCTION has_api_key_scope(p_key_id uuid, p_scope text)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM project_api_keys
    WHERE id = p_key_id
    AND p_scope = ANY(scopes)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

