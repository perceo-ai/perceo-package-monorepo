-- Clear all Perceo data for a fresh start (dev/testing only).
-- Run with: psql $DATABASE_URL -f scripts/clear-perceo-data.sql
-- Or: supabase db execute -f scripts/clear-perceo-data.sql

BEGIN;

-- Projects cascades to: project_members, personas, flows, test_runs, insights,
-- predictions, events, code_changes, analytics_connections, project_api_keys, project_secrets,
-- and their children (steps, flow_metrics, project_api_key_audit, etc.)
TRUNCATE projects CASCADE;

-- analytics_events has no FK to projects, truncate separately
TRUNCATE analytics_events CASCADE;

COMMIT;
