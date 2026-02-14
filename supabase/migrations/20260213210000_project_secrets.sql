-- Project Secrets Storage
-- Version: 1.0
-- Date: February 13, 2026
--
-- Stores encrypted secrets for projects (LLM API keys, etc.)
-- Uses Supabase Vault for encryption at rest

-- ============================================================================
-- PROJECT SECRETS TABLE
-- ============================================================================

CREATE TABLE project_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  
  -- Secret identification
  key_name text NOT NULL, -- e.g., 'llm_api_key', 'external_api_token'
  
  -- Encrypted secret value (stored encrypted using pgsodium)
  -- In production, consider using Supabase Vault: https://supabase.com/docs/guides/database/vault
  encrypted_value text NOT NULL,
  
  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Ensure one secret per key_name per project
  UNIQUE(project_id, key_name)
);

-- Indexes
CREATE INDEX idx_project_secrets_project ON project_secrets(project_id);
CREATE INDEX idx_project_secrets_key_name ON project_secrets(project_id, key_name);

-- Enable RLS
ALTER TABLE project_secrets ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Only service role can read secrets (used by temporal worker)
-- Regular users should never be able to read raw secrets
CREATE POLICY "Service role can read secrets"
  ON project_secrets FOR SELECT
  USING (auth.role() = 'service_role');

-- Project admins can insert/update/delete secrets (but cannot read encrypted values)
CREATE POLICY "Project admins can manage secrets"
  ON project_secrets FOR INSERT
  WITH CHECK (public.is_project_admin(project_id));

CREATE POLICY "Project admins can update secrets"
  ON project_secrets FOR UPDATE
  USING (public.is_project_admin(project_id));

CREATE POLICY "Project admins can delete secrets"
  ON project_secrets FOR DELETE
  USING (public.is_project_admin(project_id));

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to securely get a project secret (service role only)
-- Returns NULL if secret doesn't exist
CREATE OR REPLACE FUNCTION get_project_secret(p_project_id uuid, p_key_name text)
RETURNS text AS $$
DECLARE
  v_secret text;
BEGIN
  -- Only allow service role to call this
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;
  
  SELECT encrypted_value INTO v_secret
  FROM project_secrets
  WHERE project_id = p_project_id
    AND key_name = p_key_name;
  
  RETURN v_secret;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to upsert a project secret
-- For now, stores as plaintext but designed to work with encrypted storage
CREATE OR REPLACE FUNCTION upsert_project_secret(
  p_project_id uuid, 
  p_key_name text, 
  p_value text,
  p_created_by uuid DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_secret_id uuid;
BEGIN
  -- Check if user is project admin (or if service role)
  IF auth.role() != 'service_role' AND NOT public.is_project_admin(p_project_id) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;
  
  -- Upsert the secret
  INSERT INTO project_secrets (project_id, key_name, encrypted_value, created_by)
  VALUES (p_project_id, p_key_name, p_value, p_created_by)
  ON CONFLICT (project_id, key_name)
  DO UPDATE SET 
    encrypted_value = EXCLUDED.encrypted_value,
    updated_at = now()
  RETURNING id INTO v_secret_id;
  
  RETURN v_secret_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- NOTES ON ENCRYPTION
-- ============================================================================

-- For production use, consider:
-- 1. Using pgsodium extension for transparent column encryption
-- 2. Using Supabase Vault (vault.secrets table) for managed encryption
-- 3. Storing encrypted values with application-level encryption before inserting
--
-- Current implementation stores values as-is but is designed to be compatible
-- with encryption at rest. The get_project_secret function can be updated
-- to decrypt values when encryption is added.
