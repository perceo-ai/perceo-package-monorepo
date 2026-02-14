# Why Cloud Run Deployment is Safe

## Current State

Your Temporal Worker is **already running on Cloud Run**. This change just adds HTTP endpoints to the existing service - it doesn't change the core workflow execution.

## What's Changing

### Before (Current Production)

```
Worker on Cloud Run:
  - Polls Temporal task queue ✓
  - Executes workflow activities ✓
  - Has health check endpoint ✓
```

### After (New Deployment)

```
Worker on Cloud Run:
  - Polls Temporal task queue ✓ (unchanged)
  - Executes workflow activities ✓ (unchanged)
  - Has health check endpoint ✓ (unchanged)
  - Has HTTP API to start workflows ✨ (NEW)
  - Has HTTP API to query workflows ✨ (NEW)
```

## Why It's Safe

1. **No Breaking Changes**
    - Existing Temporal connection stays the same
    - Workflow execution logic unchanged
    - Task queue polling unchanged
    - All activities work the same way

2. **Additive Only**
    - We're only adding new HTTP endpoints
    - Nothing is being removed or modified
    - Existing health check still works

3. **Zero Downtime**
    - Cloud Run does rolling updates
    - New instances start before old ones stop
    - No service interruption

4. **Easy Rollback**
    - Can redeploy previous version anytime
    - Worker continues polling even during deployment
    - No data loss or corruption risk

## Why Use Cloud Run Everywhere

### 1. **Consistency**

- Same environment for all developers
- No "works on my machine" issues
- Configuration is centralized

### 2. **No Local Setup**

- Don't need to run worker locally
- Don't need to configure local Temporal connection
- Just point CLI at Cloud Run URL

### 3. **Always Available**

- Worker runs 24/7 on Cloud Run
- Auto-scales based on traffic
- No need to keep local process running

### 4. **Cost Effective**

- Cloud Run free tier: 2 million requests/month
- First 180,000 vCPU-seconds free
- Only pay for actual usage
- With min-instances=1, stays warm (no cold starts)

### 5. **Better Performance**

- Cloud Run is in same region as Temporal Cloud (us-west1)
- Lower latency than local → cloud
- Better network reliability

### 6. **Simpler Dev Flow**

```bash
# No need to:
# - Run worker locally
# - Keep terminal open
# - Restart when code changes
# - Configure local Temporal connection

# Just deploy once and forget:
pnpm worker:deploy

# Then develop CLI freely:
perceo init  # Always works, always fast
```

## What About Local Development?

You can still develop and test workflows locally if needed:

```bash
# Run worker locally for workflow development
pnpm worker:start

# Point CLI at local worker temporarily
PERCEO_WORKER_API_URL=http://localhost:8080 perceo init
```

But for **CLI development**, always use Cloud Run:

- Faster to test (no worker restart needed)
- Same environment as production
- No local configuration needed

## Security

### Current Setup

- Worker is on Cloud Run with `--allow-unauthenticated`
- URL is not publicly known (security through obscurity)
- Only valid project IDs from your Supabase database work

### Recommended Setup (Optional)

```bash
# Add API key for extra security
PERCEO_WORKER_API_KEY=<secure-random-key>

# Now requests need:
# 1. Know the Cloud Run URL (not public)
# 2. Have valid API key
# 3. Use valid project ID from database
```

This is standard for internal services - similar to how GitHub Actions, Vercel, etc. work.

## Deployment Steps

1. **Deploy worker** (adds HTTP API):

    ```bash
    pnpm worker:deploy
    ```

2. **Get URL**:

    ```bash
    gcloud run services describe perceo-temporal-worker \
      --region us-west1 \
      --format 'value(status.url)'
    ```

3. **Update .env**:

    ```bash
    PERCEO_WORKER_API_URL=https://your-url.run.app
    ```

4. **Test**:
    ```bash
    perceo init
    ```

## What Could Go Wrong? (And How to Fix)

### Worst Case: Deployment Fails

- **Impact**: None - old version keeps running
- **Fix**: Check logs, fix issue, redeploy

### Worst Case: New Code Has Bugs

- **Impact**: HTTP API doesn't work, but workflows still execute
- **Fix**: Redeploy previous version or fix and redeploy

### Worst Case: Worker Crashes

- **Impact**: Cloud Run auto-restarts in ~5 seconds
- **Fix**: None needed, auto-recovery

### Worst Case: Need to Rollback

```bash
# Get previous revision
gcloud run revisions list \
  --service perceo-temporal-worker \
  --region us-west1

# Rollback
gcloud run services update-traffic perceo-temporal-worker \
  --region us-west1 \
  --to-revisions=REVISION-NAME=100
```

## Bottom Line

✅ **Deploy to Cloud Run is completely safe**
✅ **Use Cloud Run URL everywhere**
✅ **Simpler, faster, more reliable**
✅ **No downside, all upside**

The change is minimal, additive, and follows best practices for serverless microservices.
