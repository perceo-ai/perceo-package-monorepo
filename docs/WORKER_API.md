# Temporal Worker HTTP API

The Perceo Temporal Worker exposes HTTP endpoints for starting and querying workflows. This eliminates the need for Supabase Edge Functions and avoids Deno compatibility issues with the Temporal gRPC client.

## Architecture

```
CLI (perceo init)
    ↓ HTTP POST
Worker HTTP API (Cloud Run)
    ↓ Temporal gRPC
Temporal Cloud
    ↓ Task Queue
Worker Process (same container)
```

The worker container runs both:
1. **HTTP API Server** - Exposes REST endpoints for starting/querying workflows
2. **Temporal Worker** - Polls task queue and executes workflow activities

## API Endpoints

### POST /api/workflows/bootstrap

Start a new bootstrap workflow.

**Request:**
```json
{
  "projectId": "uuid",
  "projectName": "my-app",
  "projectDir": "/path/to/project",
  "framework": "nextjs",
  "branch": "main"
}
```

**Headers:**
- `Content-Type: application/json`
- `x-api-key: <your-worker-api-key>` (if PERCEO_WORKER_API_KEY is set)

**Response:**
```json
{
  "workflowId": "bootstrap-uuid-1234567890",
  "message": "Bootstrap workflow started successfully"
}
```

### GET /api/workflows/:workflowId

Query workflow status and progress.

**Headers:**
- `x-api-key: <your-worker-api-key>` (if PERCEO_WORKER_API_KEY is set)

**Response:**
```json
{
  "workflowId": "bootstrap-uuid-1234567890",
  "completed": false,
  "progress": {
    "stage": "extract-personas",
    "message": "Extracting personas from codebase...",
    "percentage": 45,
    "currentChunk": 3,
    "totalChunks": 10,
    "personasExtracted": 5,
    "flowsExtracted": 12,
    "stepsExtracted": 48
  }
}
```

When completed:
```json
{
  "workflowId": "bootstrap-uuid-1234567890",
  "completed": true,
  "result": {
    "personasExtracted": 8,
    "flowsExtracted": 25,
    "stepsExtracted": 142,
    "totalCommitsProcessed": 100
  }
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok"
}
```

## Environment Variables

### Required for Worker

- `PERCEO_TEMPORAL_ADDRESS` - Temporal Cloud address (e.g., `us-west1.gcp.api.temporal.io:7233`)
- `PERCEO_TEMPORAL_API_KEY` - Temporal Cloud API key (JWT token)
- `PERCEO_TEMPORAL_NAMESPACE` - Temporal namespace
- `PERCEO_TEMPORAL_TASK_QUEUE` - Task queue name (default: `perceo-task-queue`)
- `PERCEO_SUPABASE_URL` - Supabase project URL
- `PERCEO_SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `PERCEO_OPEN_ROUTER_API_KEY` - OpenRouter API key for LLM calls

### Optional

- `PORT` - HTTP server port (default: `8080`)
- `PERCEO_WORKER_API_KEY` - API key for authentication (recommended for production)
- `PERCEO_ANTHROPIC_API_KEY` - Anthropic API key (alternative to OpenRouter)

### Required for CLI

- `PERCEO_WORKER_API_URL` - Worker API URL (e.g., `https://perceo-temporal-worker-xxxxx.run.app`)
- `PERCEO_WORKER_API_KEY` - Same API key configured on worker (if set)

## Deployment

### 1. Configure Environment Variables

Copy `.env.deploy.example` to `.env.deploy` and fill in your values:

```bash
cp .env.deploy.example .env.deploy
# Edit .env.deploy with your credentials
```

### 2. Deploy Worker to Cloud Run

```bash
pnpm worker:deploy
```

This script will:
1. Build the Docker image (if `BUILD_LOCALLY=1`)
2. Push to Artifact Registry
3. Deploy to Cloud Run with all environment variables

### 3. Configure CLI

Add the worker URL to your `.env` file:

```bash
PERCEO_WORKER_API_URL=https://perceo-temporal-worker-xxxxx-uc.a.run.app
PERCEO_WORKER_API_KEY=your-secure-api-key
```

You can get the Cloud Run URL from:
```bash
gcloud run services describe perceo-temporal-worker \
  --region us-west1 \
  --format 'value(status.url)'
```

### 4. Test

```bash
perceo init
```

## Local Development

### 1. Start Temporal Worker Locally

```bash
# Set environment variables
export PERCEO_TEMPORAL_ADDRESS=us-west1.gcp.api.temporal.io:7233
export PERCEO_TEMPORAL_API_KEY=your-temporal-jwt
export PERCEO_TEMPORAL_NAMESPACE=your-namespace.account-id
export PERCEO_SUPABASE_URL=https://your-project.supabase.co
export PERCEO_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
export PERCEO_OPEN_ROUTER_API_KEY=sk-or-v1-...

# Optional: Set API key for local testing
export PERCEO_WORKER_API_KEY=local-dev-key

# Start worker
pnpm worker:start
```

The worker will start on `http://localhost:8080`.

### 2. Configure CLI for Local Testing

In your `.env`:

```bash
PERCEO_WORKER_API_URL=http://localhost:8080
PERCEO_WORKER_API_KEY=local-dev-key
```

### 3. Test CLI

```bash
perceo init
```

## Security

### API Key Authentication

Set `PERCEO_WORKER_API_KEY` on both the worker and CLI to require authentication:

**Worker (Cloud Run):**
```bash
gcloud run services update perceo-temporal-worker \
  --region us-west1 \
  --set-env-vars PERCEO_WORKER_API_KEY=your-secure-random-key
```

**CLI (.env):**
```bash
PERCEO_WORKER_API_KEY=your-secure-random-key
```

Generate a secure API key:
```bash
openssl rand -hex 32
```

### CORS

The worker allows all origins by default for development convenience. For production, consider restricting `Access-Control-Allow-Origin` in the worker code.

## Monitoring

### View Logs

```bash
gcloud run logs read perceo-temporal-worker \
  --region us-west1 \
  --limit 100
```

### Check Worker Status

```bash
curl https://your-worker-url.run.app/health
```

## Troubleshooting

### Worker fails to connect to Temporal Cloud

Check environment variables are set correctly:
```bash
gcloud run services describe perceo-temporal-worker \
  --region us-west1 \
  --format yaml | grep -A 20 "env:"
```

### CLI can't reach worker

1. Verify worker URL:
   ```bash
   curl https://your-worker-url.run.app/health
   ```

2. Check API key matches:
   ```bash
   echo $PERCEO_WORKER_API_KEY
   ```

3. Test bootstrap endpoint:
   ```bash
   curl -X POST https://your-worker-url.run.app/api/workflows/bootstrap \
     -H "Content-Type: application/json" \
     -H "x-api-key: your-key" \
     -d '{"projectId":"test","projectName":"test","framework":"nextjs"}'
   ```

### Workflow starts but never completes

1. Check worker logs for errors
2. Verify worker is polling task queue:
   ```bash
   gcloud run logs read perceo-temporal-worker \
     --region us-west1 | grep "polling"
   ```
3. Check Temporal Cloud UI for workflow status

## Migration from Edge Functions

The Supabase Edge Functions have been removed due to Deno compatibility issues with the Temporal gRPC client. The new architecture:

**Old (Edge Functions):**
- CLI → Supabase Edge Function → Temporal Cloud
- Edge Function had issues with `@temporalio/client` in Deno's NPM compatibility layer

**New (Worker HTTP API):**
- CLI → Worker HTTP API → Temporal Cloud
- Worker uses native Node.js with full Temporal SDK support
- More reliable, easier to debug, and faster
