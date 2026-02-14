# Deployment Checklist

## Step 1: Deploy Worker to Cloud Run

```bash
# Make sure .env.deploy has all required values
pnpm worker:deploy
```

Expected output:

```
Deploying to Cloud Run (region: us-west1)...
✓ Deployment complete!
```

## Step 2: Get Cloud Run URL

```bash
gcloud run services describe perceo-temporal-worker \
  --region us-west1 \
  --format 'value(status.url)'
```

Example output:

```
https://perceo-temporal-worker-abc123-uc.a.run.app
```

## Step 3: Update .env File

Edit `.env` and set:

```bash
PERCEO_WORKER_API_URL=https://perceo-temporal-worker-abc123-uc.a.run.app
```

## Step 4: Test

```bash
perceo init
```

Expected behavior:

- ✅ "Starting bootstrap workflow..."
- ✅ Progress updates with percentage
- ✅ "Bootstrap complete!"
- ✅ Shows personas, flows, steps, commits counts

## Troubleshooting

### "Failed to start bootstrap workflow"

Check worker is running:

```bash
curl https://your-worker-url.run.app/health
```

Should return: `{"status":"ok"}`

### "Failed to query workflow progress"

Check worker logs:

```bash
gcloud run logs read perceo-temporal-worker \
  --region us-west1 \
  --limit 50
```

### Worker not deployed

Deploy it:

```bash
pnpm worker:deploy
```

## Security Note

The worker deployment uses `--allow-unauthenticated` because:

1. Cloud Run URL is not publicly known
2. Optional API key provides additional security
3. Workflow operations require valid project IDs from database

To add API key:

```bash
# Generate secure key
openssl rand -hex 32

# Deploy with API key
gcloud run services update perceo-temporal-worker \
  --region us-west1 \
  --set-env-vars PERCEO_WORKER_API_KEY=<your-key>

# Add to .env
echo "PERCEO_WORKER_API_KEY=<your-key>" >> .env
```
