# Perceo Worker HTTP API - Complete Setup Guide

## 🎯 Quick Deploy (Recommended)

Deploy worker and auto-configure CLI in one command:

```bash
pnpm deploy
```

This will:

1. Deploy worker to Cloud Run with HTTP API
2. Get the Cloud Run URL
3. Update your `.env` file automatically
4. Test the worker health

## 📋 Manual Setup

If you prefer step-by-step:

### 1. Deploy Worker

```bash
pnpm worker:deploy
```

### 2. Get Cloud Run URL

```bash
gcloud run services describe perceo-temporal-worker \
  --region us-west1 \
  --format 'value(status.url)'
```

### 3. Update .env

Add the URL to your `.env` file:

```bash
PERCEO_WORKER_API_URL=https://perceo-temporal-worker-xxxxx-uc.a.run.app
```

### 4. Test

```bash
perceo init
```

## ✅ What Was Fixed

**Problem:** Supabase Edge Functions were failing with gRPC connection timeouts when trying to connect to Temporal Cloud. The `@temporalio/client` package has known issues with Deno's NPM compatibility layer.

**Solution:** Removed Edge Functions entirely. The Temporal Worker now exposes HTTP API endpoints directly. CLI calls Cloud Run worker via HTTP instead of going through Edge Functions.

## 🏗️ New Architecture

```
CLI (perceo init)
    ↓ HTTP
Worker on Cloud Run (Native Node.js)
    ↓ gRPC (Temporal SDK)
Temporal Cloud
    ↓ Task Queue
Worker Process (same container)
```

**Benefits:**

- ✅ More reliable (native Node.js, no Deno issues)
- ✅ Simpler (one deployment instead of two)
- ✅ Faster (direct connection)
- ✅ Easier to debug (single service)

## 🔒 Security (Optional)

Add API key authentication:

```bash
# Generate secure key
openssl rand -hex 32

# Set on worker
gcloud run services update perceo-temporal-worker \
  --region us-west1 \
  --set-env-vars PERCEO_WORKER_API_KEY=your-key

# Add to .env
echo "PERCEO_WORKER_API_KEY=your-key" >> .env
```

## 📚 Documentation

- **Quick Start:** `docs/QUICKSTART_WORKER_API.md`
- **Full API Reference:** `docs/WORKER_API.md`
- **Why Cloud Run is Safe:** `docs/WHY_CLOUD_RUN_IS_SAFE.md`
- **Migration Details:** `docs/MIGRATION_EDGE_FUNCTIONS_TO_WORKER_API.md`
- **Deployment Checklist:** `DEPLOYMENT_CHECKLIST.md`

## 🧪 Testing

```bash
# Test health
curl https://your-worker-url.run.app/health

# View logs
gcloud run logs read perceo-temporal-worker \
  --region us-west1 \
  --limit 50

# Test CLI
perceo init
```

## 🔧 Troubleshooting

### Can't find Cloud Run URL?

```bash
gcloud run services describe perceo-temporal-worker \
  --region us-west1 \
  --format 'value(status.url)'
```

### Worker not responding?

Check logs:

```bash
gcloud run logs read perceo-temporal-worker \
  --region us-west1 \
  --limit 50 \
  --format json
```

### Bootstrap fails?

1. Check worker health: `curl https://your-url.run.app/health`
2. Check environment variables are set correctly
3. Check Temporal Cloud connection in logs

## 📝 Environment Variables

### Required in .env

```bash
PERCEO_WORKER_API_URL=https://your-worker-url.run.app
PERCEO_SUPABASE_URL=https://your-project.supabase.co
PERCEO_SUPABASE_ANON_KEY=your-anon-key
```

### Required in .env.deploy (for worker)

```bash
PERCEO_TEMPORAL_ADDRESS=us-west1.gcp.api.temporal.io:7233
PERCEO_TEMPORAL_API_KEY=your-jwt-token
PERCEO_TEMPORAL_NAMESPACE=your-namespace.account-id
PERCEO_SUPABASE_URL=https://your-project.supabase.co
PERCEO_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PERCEO_OPEN_ROUTER_API_KEY=sk-or-v1-...
```

## 🚀 Next Steps

1. **Deploy:** Run `pnpm deploy`
2. **Test:** Run `perceo init` in a project
3. **Monitor:** Check Cloud Run logs for any issues
4. **Secure:** Add API key (optional but recommended)

---

**Need help?** Check the docs in the `docs/` folder or see `DEPLOYMENT_CHECKLIST.md`.
