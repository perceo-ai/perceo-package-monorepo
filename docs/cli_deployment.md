## Perceo CLI Deployment Guide

**Version:** 1.1  
**Date:** February 12, 2026  
**Status:** Deployment Runbook (env-based secrets, safe config)

---

### 1. Overview

This guide explains how to deploy the Perceo CLI and the services it depends on. **Endpoints and API keys are never stored in project config**; they are supplied via **environment variables** (e.g. `.env` at build/run time or CI secrets).

Components involved:

- **Perceo CLI** (`@perceo/perceo`) — runs in your app repo and in CI.
- **Managed services** (your backend or Perceo Cloud): Observer, Analyzer, Analytics, Coordinator APIs; Flow Graph (Neo4j); Event bus (Redis); external analytics (GA4, Mixpanel, Amplitude).

Architecture details: `[docs/cli_architecture.md](./cli_architecture.md)` and `[docs/cli_managed_services.md](./cli_managed_services.md)`.

---

### 2. Configuration model (safe config + env)

#### 2.1 What lives where

| What                                                              | Where                                                    | Who sees it                             |
| ----------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------- |
| **Behavior only** (paths, strategy, provider name, feature flags) | `.perceo/config.json` (in repo)                          | Everyone — safe to commit               |
| **Endpoints, API keys, DB URLs, credentials**                     | **Environment variables only** (e.g. `.env`, CI secrets) | Never in config; only at build/run time |

`.perceo/config.json` must **not** contain:

- `apiBaseUrl`, `apiKey`, or any URLs for Observer/Analyzer/Analytics/Coordinator.
- `flowGraph.endpoint`, `flowGraph.username`, `flowGraph.password`, or any DB connection string.
- `eventBus.redisUrl` or other connection URLs.
- `analytics.credentials` or raw API keys.

The CLI (and your backend) resolve these from the environment at runtime.

#### 2.2 Environment variables (reference)

Supply these where the CLI or your backend runs. Use a `.env` file locally (git-ignored) or your platform’s secret store in CI/staging/production.

**Managed APIs (Observer, Analyzer, Analytics, Coordinator)**

| Variable              | Description                        | Example                  |
| --------------------- | ---------------------------------- | ------------------------ |
| `PERCEO_API_BASE_URL` | Base URL for Perceo APIs (no path) | `https://api.perceo.dev` |
| `PERCEO_API_KEY`      | API key for authenticated requests | (secret)                 |

If your backend uses separate URLs per service, you can use (when implemented):

- `PERCEO_OBSERVER_API_URL`, `PERCEO_ANALYZER_API_URL`, `PERCEO_ANALYTICS_API_URL`, `PERCEO_COORDINATOR_API_URL`

**Flow Graph (Neo4j)**

| Variable                | Description          | Example                                           |
| ----------------------- | -------------------- | ------------------------------------------------- |
| `PERCEO_NEO4J_URI`      | Neo4j connection URI | `neo4j+s://your-instance.databases.neo4j.io:7687` |
| `PERCEO_NEO4J_DATABASE` | Database name        | `Perceo`                                          |
| `PERCEO_NEO4J_USERNAME` | Username             | `perceo_app`                                      |
| `PERCEO_NEO4J_PASSWORD` | Password             | (secret)                                          |

**Event bus (Redis)**

| Variable           | Description           | Example                         |
| ------------------ | --------------------- | ------------------------------- |
| `PERCEO_REDIS_URL` | Redis URL for pub/sub | `rediss://your-redis-host:6379` |

**Analytics (GA4 / Mixpanel / Amplitude)**

| Variable                | Description                                | Example  |
| ----------------------- | ------------------------------------------ | -------- |
| `ANALYTICS_CREDENTIALS` | Provider credentials (JSON string or path) | (secret) |

**Login (Supabase Auth)**

| Variable                   | Description                                        | Example                          |
| -------------------------- | -------------------------------------------------- | -------------------------------- |
| `PERCEO_SUPABASE_URL`      | Supabase project URL (for `perceo login`)          | `https://xxxx.supabase.co`       |
| `PERCEO_SUPABASE_ANON_KEY` | Supabase anon/public key (for magic-link login)    | (from Supabase project settings) |
| `PERCEO_LOGIN_EMAIL`       | Optional: email for non-interactive `perceo login` | (e.g. in CI, not typical)        |

For magic-link login to work, your Supabase project must allow redirect URLs like `http://127.0.0.1:38473/callback` (or add `http://127.0.0.1:*` to **Authentication → URL Configuration → Redirect URLs**).

**Optional**

| Variable             | Description                                                              |
| -------------------- | ------------------------------------------------------------------------ |
| `PERCEO_ENV`         | `local` \| `dev` \| `staging` \| `production` (affects logging/behavior) |
| `PERCEO_CONFIG_PATH` | Override path to config file (absolute or relative to project)           |

#### 2.3 Config file resolution

- **Base config:** `<projectDir>/.perceo/config.json` (or file at `PERCEO_CONFIG_PATH`).
- **Local overrides:** If `PERCEO_ENV=local` (or `NODE_ENV=development`) and `.perceo/config.local.json` exists, it is **deep-merged** over the base config. Use this only for **non-secret overrides** (e.g. different `watch.paths`). **Do not put endpoints or keys in config.local.json**; keep using env for those.

---

### 3. Deploying step by step

#### 3.1 One-time: provision backend services

You need these running somewhere (you run them or use Perceo Cloud):

1. **Neo4j** (Flow Graph) — e.g. Neo4j Aura, or self-hosted with TLS.
2. **Redis** (event bus) — e.g. Upstash, ElastiCache, or self-hosted with TLS.
3. **Perceo APIs** — Observer, Analyzer, Analytics, Coordinator (hosted by you on Supabase/Cloud Run/etc., or Perceo Cloud).

Ensure they are reachable from:

- Machines where developers run the CLI (or from a gateway your CLI calls).
- Your CI runners, if you run `perceo ci` there.

#### 3.2 App repo: login and safe config

1. In the **application repo** (the one you want to run Perceo against), log in first (required before init):

    ```bash
    perceo login
    ```

    This uses Supabase Auth (magic link). Use `perceo login --scope global` to store credentials for all projects, or omit for project-only (stored in `.perceo/auth.json`). Set `PERCEO_SUPABASE_URL` and `PERCEO_SUPABASE_ANON_KEY` if not using the default Perceo Cloud Supabase project.

2. Then initialize Perceo:

    ```bash
    perceo init
    ```

    This creates `.perceo/config.json` with **behavior-only** settings (watch paths, CI strategy, analytics provider name, etc.). It does **not** write any endpoints or API keys.

3. Commit `.perceo/config.json`. It is safe for anyone to see. Do **not** commit `.perceo/auth.json` (add it to `.gitignore` if you use project-scoped login).

4. **Do not** add endpoints or API keys to this file or to `.perceo/config.local.json`. Keep them in env only.

#### 3.3 Where the CLI runs: inject env

**Local development (developer machine)**

- Create a **git-ignored** `.env` in the project root (or use your shell profile):

    ```bash
    # .env (do not commit)
    PERCEO_ENV=development
    PERCEO_API_BASE_URL=https://api.perceo.dev
    PERCEO_API_KEY=your_api_key_here
    PERCEO_NEO4J_URI=neo4j+s://your-neo4j-host:7687
    PERCEO_NEO4J_DATABASE=Perceo
    PERCEO_NEO4J_USERNAME=perceo_app
    PERCEO_NEO4J_PASSWORD=your_neo4j_password
    PERCEO_REDIS_URL=rediss://your-redis-host:6379
    ANALYTICS_CREDENTIALS='{"type":"service_account",...}'
    ```

- Load env before running the CLI (e.g. `source .env` or use `dotenv` in a wrapper script). Then:

    ```bash
    perceo watch --dev --analyze
    perceo analytics sync
    perceo dashboard --open
    ```

**CI (GitHub Actions / GitLab CI / etc.)**

- Store the same variables as **CI secrets** (e.g. `PERCEO_API_KEY`, `PERCEO_NEO4J_PASSWORD`, `ANALYTICS_CREDENTIALS`).
- Do **not** put them in the repo. Expose them to the job via `env:`.

    ```yaml
    env:
        PERCEO_API_BASE_URL: ${{ secrets.PERCEO_API_BASE_URL }}
        PERCEO_API_KEY: ${{ secrets.PERCEO_API_KEY }}
        PERCEO_NEO4J_URI: ${{ secrets.PERCEO_NEO4J_URI }}
        PERCEO_NEO4J_DATABASE: ${{ secrets.PERCEO_NEO4J_DATABASE }}
        PERCEO_NEO4J_USERNAME: ${{ secrets.PERCEO_NEO4J_USERNAME }}
        PERCEO_NEO4J_PASSWORD: ${{ secrets.PERCEO_NEO4J_PASSWORD }}
        PERCEO_REDIS_URL: ${{ secrets.PERCEO_REDIS_URL }}
        ANALYTICS_CREDENTIALS: ${{ secrets.ANALYTICS_CREDENTIALS }}
    ```

**Staging / production (scheduled jobs, workers)**

- Inject the same env vars via your deployment platform (Kubernetes secrets, ECS task definitions, serverless env, etc.). No config file should contain endpoints or keys.

#### 3.4 Backend / API servers

Your Observer, Analyzer, Analytics, and Coordinator services (or the single API that fronts them) should also get Neo4j, Redis, and analytics credentials **only from environment variables** at startup — same table as above. Do not bake URLs or keys into config files that are committed or shipped.

---

### 4. Example: deploy with a single `.env` (local)

1. **Provision** Neo4j + Redis + your APIs (or use Perceo Cloud).
2. **App repo:**
    - `perceo init` → commit `.perceo/config.json`.
    - Add `.env` with all `PERCEO_*` and `ANALYTICS_CREDENTIALS`; add `.env` to `.gitignore`.
3. **Run:**
    - `source .env` (or use a tool that loads `.env`).
    - `perceo watch --dev --analyze`, `perceo analytics sync`, etc.

No endpoints or API keys live in any config file; everything is plugged in via `.env` at run time.

---

### 5. Example: CI (GitHub Actions)

```yaml
name: Perceo CI

on:
    pull_request:
        branches: [main]
    push:
        branches: [main]

jobs:
    perceo:
        runs-on: ubuntu-latest
        env:
            PERCEO_API_BASE_URL: ${{ secrets.PERCEO_API_BASE_URL }}
            PERCEO_API_KEY: ${{ secrets.PERCEO_API_KEY }}
            PERCEO_NEO4J_URI: ${{ secrets.PERCEO_NEO4J_URI }}
            PERCEO_NEO4J_DATABASE: ${{ secrets.PERCEO_NEO4J_DATABASE }}
            PERCEO_NEO4J_USERNAME: ${{ secrets.PERCEO_NEO4J_USERNAME }}
            PERCEO_NEO4J_PASSWORD: ${{ secrets.PERCEO_NEO4J_PASSWORD }}
            PERCEO_REDIS_URL: ${{ secrets.PERCEO_REDIS_URL }}
            ANALYTICS_CREDENTIALS: ${{ secrets.ANALYTICS_CREDENTIALS }}

        steps:
            - uses: actions/checkout@v4

            - name: Setup Node
              uses: actions/setup-node@v4
              with:
                  node-version: "20"

            - name: Install dependencies
              run: pnpm install --no-frozen-lockfile

            - name: Build CLI
              run: pnpm run cli:build

            - name: Analyze PR with Perceo
              run: |
                  node apps/cli/dist/index.js ci analyze \
                    --base ${{ github.event.pull_request.base.sha || 'origin/main' }} \
                    --head ${{ github.sha }} \
                    --json > perceo-impact.json
```

`.perceo/config.json` is in the repo (behavior only). All secrets and URLs come from GitHub Actions secrets.

---

### 6. Temporal Worker Deployment (Optional)

The Perceo Observer Engine can optionally use Temporal workflows for durable, observable execution. This enables:

- **Durability**: Workflows survive process crashes and restarts
- **Observability**: Full execution history and metrics via Temporal UI
- **Retry logic**: Built-in exponential backoff with configurable policies
- **Scalability**: Horizontal worker scaling without state management
- **Long-running operations**: Supports watch mode and continuous monitoring

#### 6.1 When to use Temporal

**Use Temporal if you need**:
- Production-grade reliability with automatic retries
- Visibility into workflow execution history
- Long-running watch mode (hours/days)
- Horizontal scaling of workers
- Detailed observability and debugging

**Skip Temporal if**:
- You're just getting started (direct API mode is simpler)
- Your use case is basic (single init/analyze calls)
- You don't need durability guarantees
- You prefer minimal infrastructure

#### 6.2 Architecture

```
┌─────────────┐
│  CLI Tool   │  (perceo init, perceo ci analyze)
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ Observer Engine │  (checks config.temporal.enabled)
└──────┬──────────┘
       │
       ├─ If enabled: start Temporal workflow
       │              ▼
       │         ┌──────────────────┐
       │         │ Temporal Server  │
       │         └────────┬─────────┘
       │                  │
       │                  ▼
       │         ┌──────────────────┐
       │         │ Temporal Worker  │
       │         │  (apps/temporal- │
       │         │   worker)        │
       │         └────────┬─────────┘
       │                  │
       │                  ▼
       │         Activities: API calls, Git ops,
       │                    Neo4j, Redis
       │
       └─ If disabled: direct API calls (existing behavior)
```

#### 6.3 Environment Variables

Add these **in addition to** the existing Perceo variables:

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PERCEO_TEMPORAL_ENABLED` | Enable Temporal workflows | `false` | No |
| `PERCEO_TEMPORAL_ADDRESS` | Temporal server address | `localhost:7233` | When enabled |
| `PERCEO_TEMPORAL_NAMESPACE` | Temporal namespace | `perceo` | No |
| `PERCEO_TEMPORAL_TASK_QUEUE` | Task queue name | `observer-engine` | No |
| `PERCEO_TEMPORAL_TLS_CERT_PATH` | mTLS cert path (production) | - | For production |
| `PERCEO_TEMPORAL_TLS_KEY_PATH` | mTLS key path (production) | - | For production |

**Example `.env` with Temporal enabled**:

```bash
# Existing Perceo config
PERCEO_API_BASE_URL=https://api.perceo.dev
PERCEO_API_KEY=your_api_key

# Enable Temporal
PERCEO_TEMPORAL_ENABLED=true
PERCEO_TEMPORAL_ADDRESS=temporal.your-domain.com:7233
PERCEO_TEMPORAL_NAMESPACE=perceo

# Production: mTLS
PERCEO_TEMPORAL_TLS_CERT_PATH=/path/to/client.pem
PERCEO_TEMPORAL_TLS_KEY_PATH=/path/to/client-key.pem
```

#### 6.4 Local Development Setup

**1. Start Temporal server** (Docker):

```bash
docker run -p 7233:7233 -p 8233:8233 temporalio/auto-setup:latest
```

**2. Start Temporal worker** (Terminal 1):

```bash
cd apps/temporal-worker
pnpm install
pnpm build
pnpm start
```

**3. Enable Temporal in CLI** (Terminal 2):

```bash
export PERCEO_TEMPORAL_ENABLED=true
export PERCEO_TEMPORAL_ADDRESS=localhost:7233
export PERCEO_API_BASE_URL=https://api.perceo.dev
export PERCEO_API_KEY=your_key

perceo init  # Uses Temporal workflow
```

**4. View workflows** in Temporal UI at http://localhost:8080

#### 6.5 Production Deployment Options

**Option A: Docker Compose (simplest)**

```yaml
version: '3.8'
services:
  temporal:
    image: temporalio/auto-setup:latest
    ports:
      - "7233:7233"
      - "8233:8233"
    environment:
      - DB=postgresql
      - POSTGRES_SEEDS=postgres:5432

  temporal-ui:
    image: temporalio/ui:latest
    ports:
      - "8080:8080"
    environment:
      - TEMPORAL_ADDRESS=temporal:7233

  perceo-worker:
    build: ./apps/temporal-worker
    environment:
      PERCEO_TEMPORAL_ADDRESS: temporal:7233
      PERCEO_API_BASE_URL: ${PERCEO_API_BASE_URL}
      PERCEO_API_KEY: ${PERCEO_API_KEY}
    depends_on:
      - temporal
```

**Option B: Kubernetes (production)**

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
        image: your-registry/perceo-temporal-worker:latest
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
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: perceo-worker-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: perceo-temporal-worker
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

**Option C: Cloud Run (serverless)**

```bash
# Build and deploy
gcloud run deploy perceo-temporal-worker \
  --image gcr.io/your-project/perceo-temporal-worker \
  --min-instances 1 \
  --max-instances 10 \
  --set-env-vars PERCEO_TEMPORAL_ADDRESS=your-temporal-address \
  --set-secrets PERCEO_API_KEY=perceo-api-key:latest \
  --cpu 1 \
  --memory 512Mi
```

**Option D: Temporal Cloud (managed)**

1. Sign up at https://temporal.io/cloud
2. Download client certificates from Temporal Cloud
3. Configure worker:

```bash
export PERCEO_TEMPORAL_ADDRESS=your-namespace.tmprl.cloud:7233
export PERCEO_TEMPORAL_NAMESPACE=your-namespace
export PERCEO_TEMPORAL_TLS_CERT_PATH=/path/to/client.pem
export PERCEO_TEMPORAL_TLS_KEY_PATH=/path/to/client-key.pem
```

#### 6.6 Workflows

The worker provides three workflows:

**1. Bootstrap Project** (`bootstrapProjectWorkflow`)
- Detects framework
- Calls bootstrap API
- Upserts flows to Neo4j
- Publishes completion event
- Workflow ID: `bootstrap-{projectName}-{timestamp}`

**2. Analyze Changes** (`analyzeChangesWorkflow`)
- Computes Git diff
- Calls analysis API
- Publishes analysis event
- Workflow ID: `analyze-{baseSha}-{headSha}-{timestamp}`

**3. Watch Mode** (`watchModeWorkflow`)
- Long-running file monitoring
- Batches changes with debouncing
- Signals: `fileChanged`, `stopWatch`
- Workflow ID: `watch-{projectId}-{timestamp}`

#### 6.7 Monitoring and Debugging

**Temporal UI** (http://localhost:8080 or your deployment URL):
- View all workflow executions
- Inspect activity results and errors
- See retry attempts and failures
- Query workflow progress in real-time

**Worker logs**:
```bash
# Local
pnpm start  # Shows activity execution logs

# Kubernetes
kubectl logs -f deployment/perceo-temporal-worker

# Cloud Run
gcloud run logs read perceo-temporal-worker --limit 50
```

**Common issues**:

| Issue | Diagnosis | Solution |
|-------|-----------|----------|
| Worker can't connect | Check `PERCEO_TEMPORAL_ADDRESS` | Verify Temporal server is running |
| Activities failing | Check Temporal UI for error details | Verify API credentials in env |
| Workflows timing out | Check activity timeout settings | Increase `startToCloseTimeout` |
| No workflows appearing | Worker not polling | Ensure task queue matches config |

#### 6.8 Migration Strategy

**Phase 1: Infrastructure (Week 1)**
- Set up Temporal server (Docker/K8s/Cloud)
- Deploy worker with basic monitoring
- Test with a single dev project

**Phase 2: Gradual Rollout (Weeks 2-3)**
- Enable for internal projects: `PERCEO_TEMPORAL_ENABLED=true`
- Monitor via Temporal UI
- Keep direct API mode as fallback

**Phase 3: Production (Week 4)**
- Roll out to 10% of projects
- Monitor error rates and latency
- Scale workers based on load
- Full rollout when stable

**Rollback**: Set `PERCEO_TEMPORAL_ENABLED=false` to revert to direct API calls.

#### 6.9 Checklist

- [ ] Temporal server is running and accessible
- [ ] Worker deployed with correct task queue
- [ ] `PERCEO_TEMPORAL_*` env vars configured
- [ ] API credentials (existing `PERCEO_API_KEY`, etc.) accessible to worker
- [ ] Temporal UI accessible for debugging
- [ ] Worker logs show successful task polling
- [ ] Test workflow: run `perceo init` and verify in Temporal UI

See `apps/temporal-worker/README.md` for detailed worker documentation.

---

### 7. Operator checklists

**Safe config and env**

- [ ] `.perceo/config.json` contains only behavior (paths, strategy, provider name, flags). No URLs or API keys.
- [ ] All endpoints and credentials are supplied via environment variables (e.g. `.env` or CI secrets).
- [ ] `.env` is git-ignored; no secrets committed.

**Backend and data stores**

- [ ] Neo4j is provisioned and reachable; credentials in env only.
- [ ] Redis is provisioned and reachable; URL in env only.
- [ ] Observer/Analyzer/Analytics/Coordinator APIs are deployed and base URL + API key are in env.

**CLI usage**

- [ ] `perceo init` has been run; `.perceo/config.json` is committed.
- [ ] Local dev: env loaded (e.g. from `.env`) before `perceo watch` / `perceo analytics sync` / `perceo dashboard`.
- [ ] CI: all required `PERCEO_*` and `ANALYTICS_CREDENTIALS` set as secrets and exposed to the job.
- [ ] `perceo ci analyze` (and any other `perceo ci` commands) run successfully in CI.

Once these are in place, deployment is “config in repo, secrets in env” everywhere — no endpoints or API keys in any config file.
