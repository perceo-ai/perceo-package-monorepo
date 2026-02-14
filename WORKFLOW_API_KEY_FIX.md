# Workflow API Key Fix

## Problem

The bootstrap workflow was failing with "Invalid API key" error because it was trying to validate the Temporal Cloud API key (used for connecting to Temporal) against the `project_api_keys` table, which expects project-scoped API keys.

## Root Cause

- The workflow validation expected a project-specific API key with `workflows:start` scope
- The code was passing the Temporal Cloud API key instead
- The Temporal Cloud API key doesn't exist in the `project_api_keys` table

## Solution

Generate a project-specific API key with `workflows:start` scope during `perceo init` and pass it to the workflow for authorization.

## Changes Made

### 1. CLI (`apps/cli/src/commands/init.ts`)

- **Lines 165-185**: Added generation of workflow API key after project creation
    - Creates API key with `workflows:start` scope
    - Named `temporal-workflow-auth`
    - Logs key prefix for debugging
- **Lines 210-224**: Updated bootstrap request to include `workflowApiKey`
    - Added logging for project ID and workflow API key prefix
    - Pass `workflowApiKey` in request body
- **Lines 566-575**: Updated `BootstrapProjectInput` interface
    - Renamed `temporalApiKey` → `workflowApiKey`
    - Updated comment to clarify it's for workflow authorization

### 2. Temporal Worker (`apps/temporal-worker/src/index.ts`)

- **Lines 87-129**: Updated bootstrap endpoint
    - Accept `workflowApiKey` from request body
    - Validate it's present (return 400 if missing)
    - Added logging for project ID and workflow API key prefix
    - Pass `workflowApiKey` to workflow input (removed `temporalApiKey: config.apiKey`)

### 3. Bootstrap Workflow (`apps/temporal-worker/src/workflows/bootstrap-project.workflow.ts`)

- **Lines 25-36**: Updated `BootstrapProjectInput` interface
    - Renamed `temporalApiKey` → `workflowApiKey`
    - Updated comment
- **Lines 88-110**: Updated workflow to use `workflowApiKey`
    - Destructure `workflowApiKey` instead of `temporalApiKey`
    - Pass to `validateWorkflowStartActivity`

### 4. Auth Activities (`apps/temporal-worker/src/activities/auth.activities.ts`)

- **Lines 10-60**: Enhanced logging in `validateWorkflowStartActivity`
    - Log project ID and API key prefix at start
    - Log each validation step (lookup, project match, scope check)
    - Enhanced error messages with more context
    - Log success with all relevant details

## Key Points

1. **Two Different API Keys**:
    - **Temporal Cloud API Key**: Used by the worker to connect to Temporal Cloud (stored in worker config)
    - **Project Workflow API Key**: Generated per-project, stored in `project_api_keys` table, used for workflow authorization

2. **API Key Format**: `prc_<base64url_string>`
    - Generated from 32 random bytes
    - SHA256 hash stored in database
    - Only first 12 chars shown for security

3. **Scopes**:
    - CI keys: `["ci:analyze", "ci:test", "flows:read", "insights:read", "events:publish"]`
    - Workflow keys: `["workflows:start"]`

4. **Security**:
    - Each project gets its own workflow authorization key
    - Key is validated before workflow starts
    - Validation checks: key exists, belongs to project, has required scope

## Testing

To test:

```bash
# Build the CLI
pnpm cli:build

# Build the temporal worker
cd apps/temporal-worker && pnpm build

# Run perceo init
perceo init
```

Expected behavior:

- Should see "Generating workflow authorization key..." message
- Should see workflow API key prefix in logs
- Bootstrap workflow should start successfully
- Workflow validation should pass with detailed logs

## Debugging

If validation still fails, check:

1. Workflow API key was generated (check Supabase `project_api_keys` table)
2. Key has `workflows:start` scope
3. Key belongs to the correct project
4. Worker has correct Supabase credentials
5. Check worker logs for detailed validation output
