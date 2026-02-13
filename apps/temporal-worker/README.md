# Perceo Temporal Worker

This worker processes Temporal workflows for the Perceo observer engine, enabling durable workflow orchestration for bootstrap, analysis, and watch operations.

**📦 For production deployment to Temporal Cloud, see the [Temporal Worker Deployment Guide](../../docs/temporal_worker_deployment.md)**

## Overview

The Temporal worker provides:

- **Durability**: Workflows survive process crashes and restarts
- **Observability**: Full execution history via Temporal UI
- **Retry logic**: Built-in exponential backoff and error handling
- **Scalability**: Horizontal scaling without state coordination

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm
- Running Temporal server (see below)

### Local Development

1. **Start Temporal server** (using Docker):

```bash
docker run -p 7233:7233 -p 8233:8233 temporalio/auto-setup:latest
```

2. **Install dependencies**:

```bash
pnpm install
```

3. **Build the worker**:

```bash
pnpm build
```

4. **Set environment variables**:

```bash
export PERCEO_TEMPORAL_ADDRESS=localhost:7233
export PERCEO_TEMPORAL_NAMESPACE=perceo
export PERCEO_TEMPORAL_TASK_QUEUE=observer-engine

# Optional: API credentials for activities
export PERCEO_API_BASE_URL=https://api.perceo.dev
export PERCEO_API_KEY=your-key
```

5. **Start the worker**:

```bash
pnpm start
# or in dev mode with watch:
pnpm dev
```

6. **View workflows** in Temporal UI at http://localhost:8080

## Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PERCEO_TEMPORAL_ADDRESS` | Temporal server address | `localhost:7233` | Yes |
| `PERCEO_TEMPORAL_NAMESPACE` | Temporal namespace | `perceo` | No |
| `PERCEO_TEMPORAL_TASK_QUEUE` | Task queue name | `observer-engine` | No |
| `PERCEO_TEMPORAL_TLS_CERT_PATH` | mTLS cert path (production) | - | For production |
| `PERCEO_TEMPORAL_TLS_KEY_PATH` | mTLS key path (production) | - | For production |

### Activity Configuration

Activities require additional environment variables:

```bash
# Observer API (required for bootstrap and analysis)
PERCEO_API_BASE_URL=https://api.perceo.dev
PERCEO_API_KEY=your-api-key

# Neo4j Flow Graph (optional)
PERCEO_NEO4J_URI=bolt://localhost:7687
PERCEO_NEO4J_DATABASE=neo4j
PERCEO_NEO4J_USERNAME=neo4j
PERCEO_NEO4J_PASSWORD=password

# Redis Event Bus (optional)
PERCEO_REDIS_URL=redis://localhost:6379
```

## Workflows

### 1. Bootstrap Project Workflow

Initializes flows and personas for a new project.

**Workflow ID format**: `bootstrap-{projectName}-{timestamp}`

**Activities**:
- `detectFramework` - Auto-detect project framework
- `callObserverBootstrapApi` - Generate flows/personas via API
- `upsertFlowsToNeo4j` - Store flows in graph database (optional)
- `publishEvent` - Emit completion event (optional)

**Progress tracking**: Query `progress` to get current stage and percentage.

### 2. Analyze Changes Workflow

Analyzes Git changes and identifies affected flows.

**Workflow ID format**: `analyze-{baseSha}-{headSha}-{timestamp}`

**Activities**:
- `computeGitDiff` - Generate file diff between commits
- `callObserverAnalyzeApi` - Impact analysis via API
- `publishEvent` - Emit analysis event (optional)

**Fast retry policy**: 5 attempts with 500ms-10s backoff.

### 3. Watch Mode Workflow

Long-running workflow for continuous file monitoring.

**Workflow ID format**: `watch-{projectId}-{timestamp}`

**Signals**:
- `fileChanged` - Process a file change
- `stopWatch` - Gracefully stop the workflow

**Queries**:
- `status` - Get current status (running, pending changes, processed count)

**Activities**:
- `analyzeFileChange` - Single-file impact analysis
- `triggerAffectedTests` - Execute tests for affected flows (optional)
- `publishEvent` - Emit batch analysis events

## Debugging

### View Workflow Execution

1. Open Temporal UI: http://localhost:8080
2. Navigate to "Workflows"
3. Find your workflow by ID or type
4. View execution history, activity results, and errors

### Common Issues

**Worker can't connect to Temporal server**:
- Check `PERCEO_TEMPORAL_ADDRESS` is correct
- Ensure Temporal server is running: `docker ps | grep temporal`

**Activities failing with API errors**:
- Verify `PERCEO_API_BASE_URL` and `PERCEO_API_KEY` are set
- Check API connectivity: `curl ${PERCEO_API_BASE_URL}/health`

**Neo4j connection errors**:
- Verify Neo4j credentials in env vars
- Test connection: `cypher-shell -u ${PERCEO_NEO4J_USERNAME} -p ${PERCEO_NEO4J_PASSWORD}`

## Production Deployment

### Docker

```dockerfile
# Build from monorepo root
docker build -f apps/temporal-worker/Dockerfile -t perceo-temporal-worker .

# Run
docker run --env-file .env perceo-temporal-worker
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: perceo-temporal-worker
spec:
  replicas: 3  # Scale horizontally
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
        image: perceo-temporal-worker:latest
        env:
        - name: PERCEO_TEMPORAL_ADDRESS
          value: "temporal-frontend:7233"
        - name: PERCEO_API_KEY
          valueFrom:
            secretKeyRef:
              name: perceo-secrets
              key: api-key
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

### Cloud Run (Serverless)

```bash
gcloud run deploy perceo-temporal-worker \
  --image gcr.io/your-project/perceo-temporal-worker \
  --min-instances 1 \
  --max-instances 10 \
  --set-env-vars PERCEO_TEMPORAL_ADDRESS=your-temporal-address \
  --set-secrets PERCEO_API_KEY=perceo-api-key:latest
```

### Temporal Cloud

For managed Temporal infrastructure with mTLS:

```bash
# Download client cert and key from Temporal Cloud
export PERCEO_TEMPORAL_ADDRESS=your-namespace.tmprl.cloud:7233
export PERCEO_TEMPORAL_NAMESPACE=your-namespace
export PERCEO_TEMPORAL_TLS_CERT_PATH=/path/to/client.pem
export PERCEO_TEMPORAL_TLS_KEY_PATH=/path/to/client-key.pem

pnpm start
```

## Testing

```bash
# Run unit tests
pnpm test

# Run workflow tests (requires test environment)
pnpm test:workflows

# Run integration tests (requires Temporal server)
pnpm test:integration
```

## Architecture

```
┌─────────────┐
│  CLI Tool   │
└──────┬──────┘
       │ starts workflow
       ▼
┌─────────────────┐
│ Temporal Server │
└──────┬──────────┘
       │ schedules task
       ▼
┌─────────────────┐     ┌──────────────────┐
│ Temporal Worker │────▶│ Activities       │
│  (this app)     │     │ - API calls      │
└─────────────────┘     │ - Git operations │
                        │ - Neo4j/Redis    │
                        └──────────────────┘
```

## Contributing

When adding new workflows or activities:

1. Define workflow in `src/workflows/`
2. Implement activities in `src/activities/`
3. Export from `src/workflows/index.ts` and `src/activities/index.ts`
4. Add tests in `src/__tests__/`
5. Update this README with workflow details

## Links

- [Temporal Documentation](https://docs.temporal.io)
- [Temporal TypeScript SDK](https://typescript.temporal.io)
- [Perceo CLI Deployment Guide](../../docs/cli_deployment.md)
