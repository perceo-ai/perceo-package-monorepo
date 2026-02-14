# Quick Start: New Worker HTTP API

## TL;DR

Supabase Edge Functions removed due to Deno/gRPC compatibility issues. Worker now exposes HTTP API directly. **Always use the Cloud Run URL, even for local development.**

## What You Need to Do

### 1. Deploy Worker (One Time)

```bash
# Deploy worker with HTTP API
pnpm worker:deploy

# Get the Cloud Run URL
gcloud run services describe perceo-temporal-worker \
  --region us-west1 \
  --format 'value(status.url)'

# Example output: https://perceo-temporal-worker-abc123-uc.a.run.app
```

### 2. Configure CLI

Update your `.env` file with the Cloud Run URL:

```bash
# Use Cloud Run URL everywhere (local dev and production)
PERCEO_WORKER_API_URL=https://perceo-temporal-worker-abc123-uc.a.run.app

# Optional: Add API key if configured on worker
PERCEO_WORKER_API_KEY=your-api-key
```

### 3. Test

```bash
perceo init
```

## Why Cloud Run Everywhere?

- ✅ **Simpler**: One configuration for all environments
- ✅ **Reliable**: No local worker setup needed
- ✅ **Always Available**: Cloud Run auto-scales and stays warm
- ✅ **Consistent**: Same environment in dev and production
- ✅ **Free Tier**: Low usage stays in GCP free tier

## New Environment Variables

### CLI (`.env`)

```bash
# Required - Get from: gcloud run services describe perceo-temporal-worker --region us-west1 --format 'value(status.url)'
PERCEO_WORKER_API_URL=https://perceo-temporal-worker-xxxxx-uc.a.run.app

# Optional (if worker has API key)
PERCEO_WORKER_API_KEY=your-api-key
```

### Worker (`.env.deploy`)

```bash
# Already have these:
PERCEO_TEMPORAL_ADDRESS=...
PERCEO_TEMPORAL_API_KEY=...
PERCEO_TEMPORAL_NAMESPACE=...
PERCEO_SUPABASE_URL=...
PERCEO_SUPABASE_SERVICE_ROLE_KEY=...
PERCEO_OPEN_ROUTER_API_KEY=...

# Optional new one:
PERCEO_WORKER_API_KEY=your-secure-key  # Recommended for production
```

## What Changed

- ✅ Worker now has HTTP API endpoints
- ✅ CLI calls Cloud Run worker directly (no Edge Functions)
- ✅ More reliable (native Node.js + Temporal SDK)
- ✅ Simpler deployment (one artifact instead of two)
- ❌ Removed all Supabase Edge Functions

## Deployment is Safe

The worker is already running on Cloud Run. We're just:

1. Adding HTTP endpoints to the existing service
2. Redeploying with the updated code

Your existing workflows and Temporal connection remain unchanged.

## Docs

- Full API reference: `docs/WORKER_API.md`
- Migration details: `docs/MIGRATION_EDGE_FUNCTIONS_TO_WORKER_API.md`
