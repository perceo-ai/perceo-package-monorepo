# Perceo Deployment Guide

This guide covers deploying the full Perceo stack with secure architecture.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User's Machine                            │
│                                                                   │
│  CLI (perceo init, perceo analyze)                               │
│     │                                                             │
│     │ (Uses publishable key only)                                │
│     ├──────────────────────────────────────────┐                 │
└─────┼────────────────────────────────────────┐ │                 │
      │                                        │ │                 │
      │                                        │ │                 │
      ▼                                        ▼ ▼                 │
┌─────────────────────────────────────────────────────────────────┤
│               Supabase (Managed Backend)                         │
│                                                                  │
│  ┌─────────────────┐        ┌──────────────────┐               │
│  │  Edge Functions  │───────▶│  Database (RLS)   │               │
│  │                  │        │                   │               │
│  │  - bootstrap     │        │  - projects       │               │
│  │  - query-workflow│        │  - flows          │               │
│  └────────┬─────────┘        │  - personas       │               │
│           │                  └──────────────────┘               │
│           │                                                      │
│           │ (Uses service role key & Temporal creds)            │
│           │                                                      │
└───────────┼──────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────┐
│              Temporal Cloud / Self-Hosted                         │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Temporal Worker (apps/temporal-worker)                      │ │
│  │                                                               │ │
│  │  Workflows:                                                   │ │
│  │  - bootstrapProjectWorkflow                                   │ │
│  │  - analyzeChangesWorkflow (future)                            │ │
│  │                                                                │ │
│  │  Activities:                                                  │ │
│  │  - Git operations                                             │ │
│  │  - LLM extraction (via OpenRouter/Anthropic)                  │ │
│  │  - Database persistence (Supabase)                            │ │
│  └───────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

## Deployment Steps

### 1. Supabase Setup

#### 1.1 Create Project

```bash
# Via Supabase Dashboard or CLI
supabase projects create perceo-prod

# Get your project credentials
# - URL: https://your-project.supabase.co
# - Publishable key (anon): Safe to expose
# - Service role key: Keep secret!
```

#### 1.2 Run Migrations

```bash
cd perceo-package-monorepo

# Link to your project
supabase link --project-ref your-project-ref

# Push migrations
supabase db push
```

#### 1.3 Deploy Edge Functions

```bash
# Set secrets (do this once)
supabase secrets set PERCEO_TEMPORAL_ADDRESS=us-west1.gcp.api.temporal.io:7233
supabase secrets set PERCEO_TEMPORAL_API_KEY=<your-temporal-jwt>
supabase secrets set PERCEO_TEMPORAL_NAMESPACE=<your-namespace>
supabase secrets set PERCEO_TEMPORAL_TASK_QUEUE=perceo-task-queue
supabase secrets set PERCEO_SUPABASE_URL=https://your-project.supabase.co
supabase secrets set PERCEO_SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
supabase secrets set PERCEO_OPEN_ROUTER_API_KEY=<your-openrouter-key>

# Deploy functions
supabase functions deploy bootstrap-project
supabase functions deploy query-workflow

# Verify
supabase functions list
```

### 2. Temporal Setup

#### Option A: Temporal Cloud (Recommended)

1. Sign up at [temporal.io](https://temporal.io)
2. Create a namespace
3. Generate API key (JWT)
4. Note your connection details:
    - Address: `<region>.gcp.api.temporal.io:7233`
    - Namespace: `<namespace>.<account-id>`

#### Option B: Self-Hosted

```bash
# Using docker-compose (see apps/temporal-worker/docker-compose.yml)
cd apps/temporal-worker
docker-compose up -d

# Temporal will be available at localhost:7233
```

### 3. Temporal Worker Deployment

The worker processes Temporal workflows and needs to run continuously.

#### Option A: Cloud Run (Google Cloud)

```bash
cd apps/temporal-worker

# Build and push Docker image
gcloud builds submit --tag gcr.io/your-project/perceo-temporal-worker

# Deploy to Cloud Run
gcloud run deploy perceo-temporal-worker \
  --image gcr.io/your-project/perceo-temporal-worker \
  --platform managed \
  --region us-west1 \
  --set-env-vars "PERCEO_TEMPORAL_ADDRESS=us-west1.gcp.api.temporal.io:7233" \
  --set-env-vars "PERCEO_TEMPORAL_NAMESPACE=your-namespace.account-id" \
  --set-env-vars "PERCEO_TEMPORAL_API_KEY=your-jwt-token" \
  --set-env-vars "PERCEO_SUPABASE_URL=https://your-project.supabase.co" \
  --set-env-vars "PERCEO_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key" \
  --set-env-vars "PERCEO_OPEN_ROUTER_API_KEY=your-openrouter-key" \
  --min-instances 1 \
  --max-instances 10 \
  --memory 1Gi
```

#### Option B: Kubernetes

```yaml
# kubernetes/temporal-worker-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
    name: perceo-temporal-worker
spec:
    replicas: 3
    selector:
        matchLabels:
            app: perceo-temporal-worker
    template:
        metadata:
            labels:
                app: perceo-temporal-worker
        spec:
            containers:
                - name: worker
                  image: gcr.io/your-project/perceo-temporal-worker:latest
                  env:
                      - name: PERCEO_TEMPORAL_ADDRESS
                        valueFrom:
                            secretKeyRef:
                                name: perceo-secrets
                                key: temporal-address
                      - name: PERCEO_TEMPORAL_API_KEY
                        valueFrom:
                            secretKeyRef:
                                name: perceo-secrets
                                key: temporal-api-key
                  # ... more env vars from secrets
```

#### Option C: Local Development

```bash
cd apps/temporal-worker

# Install dependencies
pnpm install

# Build
pnpm build

# Run worker
pnpm start
```

### 4. CLI Configuration for Users

Users only need to set Supabase credentials (safe to expose):

```bash
# In their project or globally
export PERCEO_SUPABASE_URL=https://your-project.supabase.co
export PERCEO_SUPABASE_ANON_KEY=your-publishable-key

# Or use perceo login (recommended)
perceo login
```

**What users DON'T need:**

- ❌ Temporal credentials (handled by Edge Functions)
- ❌ Service role keys (handled by Edge Functions)
- ❌ LLM API keys (handled by Worker)

## Security Best Practices

### Credentials Management

```bash
# ✅ Safe to expose (publish to NPM, commit to repos)
PERCEO_SUPABASE_URL=https://your-project.supabase.co
PERCEO_SUPABASE_ANON_KEY=eyJ...  # Publishable key

# ❌ NEVER expose (server-side only)
PERCEO_SUPABASE_SERVICE_ROLE_KEY=eyJ...
PERCEO_TEMPORAL_API_KEY=eyJ...
PERCEO_OPEN_ROUTER_API_KEY=sk-or-v1-...
```

### Row Level Security (RLS)

Ensure RLS is enabled on all tables:

```sql
-- Already in migrations
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE steps ENABLE ROW LEVEL SECURITY;

-- Users can only access their own projects
CREATE POLICY "Users can view their own projects"
  ON projects FOR SELECT
  USING (auth.uid() = user_id);
```

### Edge Function Security

- All requests require valid JWT (`Authorization: Bearer <token>`)
- Service role key never exposed to clients
- Temporal credentials stored as Supabase secrets
- CORS configured for your domains only

## Monitoring

### Edge Functions

```bash
# View logs
supabase functions logs bootstrap-project --tail

# Monitor invocations
# Via Supabase Dashboard → Edge Functions
```

### Temporal Workflows

```bash
# Temporal Cloud Dashboard
# View workflow executions, errors, and metrics

# CLI
temporal workflow list --namespace your-namespace
temporal workflow describe --workflow-id bootstrap-<uuid>-<timestamp>
```

### Temporal Worker

```bash
# Cloud Run logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=perceo-temporal-worker" --limit 50 --format json

# Or Kubernetes
kubectl logs -f deployment/perceo-temporal-worker
```

## Troubleshooting

### CLI can't connect to Supabase

```bash
# Check URL and key
echo $PERCEO_SUPABASE_URL
echo $PERCEO_SUPABASE_ANON_KEY

# Test connection
curl "$PERCEO_SUPABASE_URL/rest/v1/projects" \
  -H "apikey: $PERCEO_SUPABASE_ANON_KEY"
```

### Edge Function errors

```bash
# Check function logs
supabase functions logs bootstrap-project --tail

# Common issues:
# - Missing secrets: Check `supabase secrets list`
# - Invalid Temporal credentials
# - Network connectivity to Temporal
```

### Workflow not starting

```bash
# Check worker is running
# Cloud Run: Check service is deployed and healthy
# K8s: kubectl get pods -l app=perceo-temporal-worker

# Check Temporal connection
# View worker logs for connection errors

# Verify workflow is registered
temporal workflow list --namespace your-namespace
```

### Workflow stuck/failed

```bash
# View workflow execution
temporal workflow describe --workflow-id <id>

# View workflow history (detailed)
temporal workflow show --workflow-id <id>

# Common issues:
# - LLM API key invalid/rate limited
# - Database connection issues
# - Git repository not accessible
```

## Scaling

### Edge Functions

- Auto-scales with Supabase
- No configuration needed

### Temporal Worker

- **Cloud Run:** Increase `--max-instances`
- **Kubernetes:** Increase `replicas`
- **Recommended:** 1 worker per 10-20 concurrent workflows

### Database

- Supabase auto-scales storage
- Consider upgrading plan for high volume
- Add read replicas for heavy analytics

## Cost Optimization

### Supabase

- **Free tier:** 500MB database, 2GB bandwidth/month
- **Pro:** $25/month, 8GB database, 50GB bandwidth
- **Edge Functions:** First 500K requests free

### Temporal Cloud

- **Free tier:** 1K workflow executions/month
- **Growth:** $200/month, unlimited executions
- **Consider:** Self-hosted for high volume

### Temporal Worker (Cloud Run)

- **Estimate:** $10-50/month depending on load
- Use `--min-instances 0` if low volume (cold starts OK)
- Use `--min-instances 1` for production (always warm)

## Next Steps

1. ✅ Deploy Supabase and Edge Functions
2. ✅ Set up Temporal (Cloud or self-hosted)
3. ✅ Deploy Temporal Worker
4. ✅ Test with `perceo init` in a project
5. ✅ Monitor logs and metrics
6. ✅ Scale as needed

For support, see the main [README](../README.md) or open an issue.
