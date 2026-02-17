-- Migration: Support route-first bootstrap (BOOTSTRAP_SPEC)
-- - Flows: allow same flow name for different personas (one flow per persona-flow pair).
--   Previously UNIQUE(project_id, name) prevented this.
-- - graph_data: document/store pages (route paths) and connectedFlowIds from route-first bootstrap.
-- Date: February 16, 2026

-- Drop the unique constraint that prevented duplicate flow names per project.
-- Route-first bootstrap creates one flow row per (persona, flow) pair, so the same
-- flow name (e.g. "Submit login") can appear for multiple personas.
ALTER TABLE flows
  DROP CONSTRAINT IF EXISTS flows_project_id_name_key;

-- Allow duplicate (project_id, name) when persona_id differs; prevent duplicate
-- (project_id, name, persona_id) so we don't insert the same flow twice for one persona.
-- When persona_id IS NULL, multiple rows with same (project_id, name) are allowed (NULLs distinct in UNIQUE).
CREATE UNIQUE INDEX flows_project_id_name_persona_id_key
  ON flows (project_id, name, persona_id);

-- Document graph_data shape for route-first bootstrap (application-level; column remains jsonb).
-- Expected keys: triggerConditions (string[]), pages (string[]), connectedFlowIds (string[]).
COMMENT ON COLUMN flows.graph_data IS 'JSONB: triggerConditions (string[]), pages (string[] route paths for this flow), connectedFlowIds (string[] flow names this flow connects to). Used by route-first bootstrap.';

-- Personas: no schema change. source remains 'user_configured' | 'auto_generated'.
-- Route-first bootstrap creates personas via assignPersonasToFlows (LLM) and persists with source = 'auto_generated'.
COMMENT ON COLUMN personas.source IS 'user_configured = from project config; auto_generated = from bootstrap (route-first assignPersonasToFlows or legacy diff extraction).';
