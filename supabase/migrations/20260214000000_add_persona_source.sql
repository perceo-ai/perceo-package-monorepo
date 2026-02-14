-- Add source field to personas table to track if they are user-configured or auto-generated
-- Date: February 14, 2026

ALTER TABLE personas 
ADD COLUMN source text CHECK (source IN ('user_configured', 'auto_generated')) DEFAULT 'auto_generated';

-- Index for querying personas by source
CREATE INDEX idx_personas_source ON personas(project_id, source);

-- Update existing personas to be marked as auto-generated
UPDATE personas SET source = 'auto_generated' WHERE source IS NULL;