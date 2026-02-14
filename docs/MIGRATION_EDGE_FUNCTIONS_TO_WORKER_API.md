# Migration: Supabase Edge Functions → Worker HTTP API

## Problem

The bootstrap workflow was failing with a 500 error when invoked through Supabase Edge Functions:

```
Error: Failed to connect before the deadline
```

**Root Cause:** The `@temporalio/client` NPM package has known compatibility issues with Deno's NPM compatibility layer, particularly with gRPC/HTTP2 connections. This made it impossible to reliably connect to Temporal Cloud from Supabase Edge Functions.

## Solution

Removed Supabase Edge Functions entirely and added HTTP API endpoints directly to the Temporal Worker. The worker now serves both roles:
1. Polls Temporal task queue (existing functionality)
2. Exposes REST API for starting/querying workflows (new functionality)

## What Changed

### 1. Temporal Worker (`apps/temporal-worker/src/index.ts`)

**Added:**
- HTTP API server with three endpoints:
  - `POST /api/workflows/bootstrap` - Start bootstrap workflow
  - `GET /api/workflows/:id` - Query workflow status
  - `GET /health` - Health check
- CORS headers for cross-origin requests
- Optional API key authentication via `PERCEO_WORKER_API_KEY`

**Benefits:**
- Native Node.js environment with full Temporal SDK support
- No Deno compatibility issues
- Single deployment artifact
- Easier debugging and monitoring

### 2. CLI (`apps/cli/src/commands/init.ts`)

**Changed:**
- Replaced Supabase Edge Function calls with direct HTTP calls to worker API
- Uses `fetch()` instead of `supabaseClient.functions.invoke()`
- Reads `PERCEO_WORKER_API_URL` and `PERCEO_WORKER_API_KEY` from environment

### 3. Deleted Files

- `supabase/functions/bootstrap-project/index.ts`
- `supabase/functions/query-workflow/index.ts`
- `supabase/deploy-functions.sh`
- `supabase/deploy-functions-manual.sh`

### 4. Updated Configuration

**`.env.example`:**
- Added `PERCEO_WORKER_API_URL` and `PERCEO_WORKER_API_KEY`
- Reorganized sections to clarify CLI vs Worker variables

**`.env.deploy.example`:**
- Renamed from "Edge Functions" to "Temporal Worker" deployment
- Added `PERCEO_WORKER_API_KEY` for API authentication
- Removed `SUPABASE_PROJECT_REF` (no longer needed)

**`scripts/deploy-temporal-worker.sh`:**
- Added new environment variables to Cloud Run deployment:
  - `PERCEO_WORKER_API_KEY`
  - `PERCEO_SUPABASE_URL`
  - `PERCEO_SUPABASE_SERVICE_ROLE_KEY`
  - `PERCEO_OPEN_ROUTER_API_KEY`

**`package.json`:**
- Removed `functions:deploy` and `functions:deploy:manual` scripts

### 5. New Documentation

**`docs/WORKER_API.md`:**
- Complete API reference
- Deployment guide
- Local development setup
- Security best practices
- Troubleshooting guide

## Architecture Comparison

### Before (Edge Functions)

```
CLI
  ↓ HTTP
Supabase Edge Function (Deno)
  ↓ gRPC (FAILS HERE)
Temporal Cloud
  ↓ Task Queue
Worker (Cloud Run)
```

**Issues:**
- Deno NPM compatibility layer breaks gRPC
- Two deployment artifacts (Edge Functions + Worker)
- Harder to debug connection issues

### After (Worker HTTP API)

```
CLI
  ↓ HTTP
Worker HTTP API (Cloud Run)
  ↓ gRPC (Node.js native)
Temporal Cloud
  ↓ Task Queue
Worker Process (same container)
```

**Benefits:**
- Single deployment artifact
- Native Node.js with full Temporal support
- Direct connection to Temporal Cloud
- Simpler architecture
- Better error messages

## Deployment Changes

### Before

1. Deploy worker: `pnpm worker:deploy`
2. Deploy edge functions: `pnpm functions:deploy`
3. Configure Supabase secrets

### After

1. Deploy worker: `pnpm worker:deploy` (includes HTTP API)
2. Get Cloud Run URL and set in `.env`:
   ```bash
   PERCEO_WORKER_API_URL=https://your-worker-url.run.app
   ```

## Environment Variables

### New Variables (CLI)

```bash
# Required
PERCEO_WORKER_API_URL=https://your-worker-url.run.app

# Optional (if worker has API key configured)
PERCEO_WORKER_API_KEY=your-api-key
```

### New Variables (Worker)

```bash
# Optional but recommended for production
PERCEO_WORKER_API_KEY=your-secure-api-key
```

## Security Improvements

1. **Optional API Key**: Worker can now require API key authentication
2. **Single Point of Control**: All workflow operations go through one service
3. **No JWT Token Exposure**: CLI no longer needs to pass tokens to intermediate service

## Testing

### Local Development

1. Start worker locally:
   ```bash
   pnpm worker:start
   ```

2. Configure CLI for local worker:
   ```bash
   PERCEO_WORKER_API_URL=http://localhost:8080
   ```

3. Run init:
   ```bash
   perceo init
   ```

### Production

1. Deploy worker:
   ```bash
   pnpm worker:deploy
   ```

2. Get URL:
   ```bash
   gcloud run services describe perceo-temporal-worker \
     --region us-west1 \
     --format 'value(status.url)'
   ```

3. Configure CLI:
   ```bash
   PERCEO_WORKER_API_URL=https://your-url.run.app
   ```

## Next Steps

1. **Deploy the updated worker** to Cloud Run:
   ```bash
   pnpm worker:deploy
   ```

2. **Update your `.env`** with the worker URL:
   ```bash
   PERCEO_WORKER_API_URL=<cloud-run-url>
   ```

3. **Test locally** before deploying:
   ```bash
   # Terminal 1: Start worker
   pnpm worker:start
   
   # Terminal 2: Run init
   perceo init
   ```

4. **Consider adding API key** for production security:
   ```bash
   # Generate secure key
   openssl rand -hex 32
   
   # Set on worker
   gcloud run services update perceo-temporal-worker \
     --set-env-vars PERCEO_WORKER_API_KEY=<key>
   
   # Set in CLI .env
   PERCEO_WORKER_API_KEY=<key>
   ```

## Rollback Plan

If issues arise, you can revert by:

1. Restore the deleted Supabase Edge Functions from git history
2. Revert changes to `apps/cli/src/commands/init.ts`
3. Redeploy edge functions with `pnpm functions:deploy`

However, this is unlikely to be necessary as the new architecture is more reliable.
