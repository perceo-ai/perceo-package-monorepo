-- Add git_remote_url to projects table
-- This stores the GitHub remote URL for project tracking

ALTER TABLE projects
ADD COLUMN git_remote_url TEXT;

-- Create index for efficient lookups by git remote
CREATE INDEX idx_projects_git_remote ON projects(git_remote_url);

-- Add comment
COMMENT ON COLUMN projects.git_remote_url IS 'GitHub remote URL (e.g., https://github.com/owner/repo)';
