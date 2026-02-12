## Perceo CLI Deployment Guide

**Version:** 1.0  
**Date:** February 12, 2026  
**Status:** Deployment Runbook (Local, Staging, Production)

---

### 1. Overview

This guide explains how to deploy all components that the Perceo CLI expects to exist in a real environment:

- **Perceo CLI** (`@perceo/perceo`)
- **Observer Engine APIs** (bootstrap + change analysis)
- **Analyzer / Analytics / Coordinator APIs**
- **Flow Graph database (Neo4j)**
- **Event bus (Redis)**
- **External analytics providers (GA4, Mixpanel, Amplitude)**

Architecture and data-flow details live in:

- `[docs/cli_architecture.md](./cli_architecture.md)`
- `[docs/cli_managed_services.md](./cli_managed_services.md)`

This document focuses on **how to stand everything up** in practice.

---

### 2. Environments and configuration model

Perceo uses a layered configuration model driven by:

- `.perceo/config.json` – base config, checked into your app repo.
- `.perceo/config.local.json` – optional local overrides, usually git‑ignored.
- Environment variables – for secrets and environment-specific endpoints.

Key env vars:

- `PERCEO_ENV=local|dev|staging|production`
- `PERCEO_CONFIG_PATH=/absolute/or/relative/path/to/config.json`

Resolution rules (implemented by the CLI):

- CLI reads `.perceo/config.json` by default.
- If `PERCEO_ENV=local` (or `NODE_ENV=development`) and `.perceo/config.local.json` exists, it is deep‑merged over the base config.
- If `PERCEO_CONFIG_PATH` is set, that file is used instead of `.perceo/config.json`.

You can keep **production endpoints** in `.perceo/config.json` (no secrets) and **local overrides + secrets paths** in `.perceo/config.local.json`.

---

### 3. Components to deploy

#### 3.1 Flow Graph database (Neo4j)

**Purpose:**  
Holds flows, personas, synthetic test results, production metrics, and analyzer insights.

**Used by:** Observer, Analyzer, Analytics, Coordinator, Dashboard.

Config section (simplified):

```jsonc
{
	"flowGraph": {
		"endpoint": "neo4j+s://<host>:7687",
		"database": "Perceo",
		"username": "perceo_app",
		"password": "${PERCEO_NEO4J_PASSWORD}",
	},
}
```

Deployment options:

- **Local dev (Docker)** – quickest way to get started.
- **Neo4j Aura / managed Neo4j** – recommended for production.
- **Self-hosted Neo4j (Kubernetes/VMs)** – for full control.

Minimum requirements:

- TLS for production (`neo4j+s://`).
- App/service user with least-privilege credentials.
- Backups + monitoring for production.

#### 3.2 Event bus (Redis)

**Purpose:**  
Pub/sub channel between Observer, Analyzer, Analytics, Coordinator, and CLI.

Config section:

```jsonc
{
	"eventBus": {
		"type": "redis",
		"redisUrl": "rediss://<redis-host>:6379",
	},
}
```

Deployment options:

- **Local dev**
    - `type: "in-memory"` – simplest, single-process only.
    - `type: "redis"` with Docker – matches production topology.
- **Production**
    - Managed Redis (AWS ElastiCache, GCP Memorystore, Azure Cache, Upstash, etc.).

Best practices:

- Prefer TLS endpoints (`rediss://`).
- Use ACLs or per-app credentials.
- Place Redis in a private network; only engines and dashboards should reach it.

#### 3.3 Perceo managed APIs (Observer, Analyzer, Analytics, Coordinator)

The CLI does not embed engine code. Instead it calls **managed APIs** that encapsulate:

- Flow and persona discovery.
- Change impact analysis (Observer).
- Insights and predictions (Analyzer).
- Analytics ingestion + correlation (Analytics).
- Test orchestration (Coordinator).

Config shape (example):

```jsonc
{
	"observer": {
		"apiBaseUrl": "https://api.perceo.dev/observer",
		"apiKey": "${PERCEO_API_KEY}",
		"watch": { "paths": ["app/", "src/"], "ignore": ["node_modules/"] },
		"ci": { "strategy": "affected-flows", "parallelism": 5 },
		"analysis": { "useLLM": true, "llmThreshold": 0.7 },
	},
	"analyzer": {
		"apiBaseUrl": "https://api.perceo.dev/analyzer",
		"apiKey": "${PERCEO_API_KEY}",
	},
	"analytics": {
		"apiBaseUrl": "https://api.perceo.dev/analytics",
		"apiKey": "${PERCEO_API_KEY}",
		"provider": "ga4",
		"credentials": "${ANALYTICS_CREDENTIALS}",
	},
	"coordinator": {
		"apiBaseUrl": "https://api.perceo.dev/coordinator",
		"apiKey": "${PERCEO_API_KEY}",
	},
}
```

You have two main deployment modes:

##### Option A: Perceo Cloud (recommended for production)

- Engines and APIs are hosted by Perceo.
- You receive:
    - Base URL(s) like `https://api.perceo.dev`.
    - Project ID / API key.
    - Possibly environment-specific URLs (staging vs prod).

**You deploy:**

- Your application(s).
- The Perceo CLI in CI pipelines and developer machines.
- `.perceo/config.json` referencing Perceo Cloud endpoints and using env vars for secrets.

##### Option B: Self-hosted Supabase (local, staging, or production)

- Supabase provides:
    - Postgres + Auth.
    - Edge Functions runtime.
    - Studio for management.

**Deployment steps (high level):**

1. **Create a Supabase project** (or use an existing one).
2. **Define database schema** for:
    - Events.
    - Metrics and production analytics.
    - Flow engine state and configuration.
3. **Implement Edge Functions**:
    - `/observer/bootstrap`
    - `/observer/analyze`
    - `/analyzer/*`
    - `/analytics/*`
    - `/coordinator/*`
4. **Configure the CLI** to point at your hosted Supabase functions:

```jsonc
{
	"observer": {
		"apiBaseUrl": "https://<project>.functions.supabase.co/perceo-observer",
		"apiKey": "${PERCEO_SUPABASE_SERVICE_KEY}",
	},
}
```

5. **Lock down access** using:
    - Service keys in CI only.
    - Row-level security for app/user data where appropriate.

#### 3.4 External analytics providers (GA4, Mixpanel, Amplitude)

**Purpose:**  
Provide real-world behavioural metrics that Analytics + Analyzer use to:

- Compute production success rates.
- Detect coverage gaps.
- Estimate revenue impact.

Config section:

```jsonc
{
	"analytics": {
		"provider": "ga4",
		"credentials": "${ANALYTICS_CREDENTIALS}",
		"syncInterval": 300,
		"correlation": {
			"algorithm": "smith-waterman",
			"minSimilarity": 0.7,
		},
	},
}
```

Deployment requirements:

- Separate staging vs production properties/projects.
- Service credentials for server-side access:
    - GA4: service account JSON with `analytics.readonly`.
    - Mixpanel/Amplitude: project API keys.
- Secrets stored **outside git**, injected via environment variables.

---

### 4. Local development deployment

This setup lets a single developer run the entire loop on a laptop.

#### 4.1 Step-by-step

1. **Start Neo4j (Docker)**

    ```bash
    docker run \
      --name perceo-neo4j \
      -p 7474:7474 -p 7687:7687 \
      -e NEO4J_AUTH=neo4j/test1234 \
      neo4j:5
    ```

2. **Start Redis (optional but recommended)**

    ```bash
    docker run -d --name perceo-redis -p 6379:6379 redis:7
    ```

3. **Start local Supabase stack (if self-hosting engines locally)**

    ```bash
    mkdir -p perceo-services
    cd perceo-services
    supabase init
    supabase start
    ```

4. **Configure `.perceo/config.local.json` in your app repo**

    Example:

    ```jsonc
    {
    	"flowGraph": {
    		"endpoint": "bolt://localhost:7687",
    		"database": "PerceoDev",
    	},
    	"eventBus": {
    		"type": "redis",
    		"redisUrl": "redis://localhost:6379",
    	},
    	"observer": {
    		"apiBaseUrl": "http://127.0.0.1:54321/functions/v1/perceo-observer",
    	},
    	"analyzer": {
    		"apiBaseUrl": "http://127.0.0.1:54321/functions/v1/perceo-analyzer",
    	},
    	"analytics": {
    		"apiBaseUrl": "http://127.0.0.1:54321/functions/v1/perceo-analytics",
    		"provider": "ga4",
    		"credentials": "file:.perceo/secrets/ga4-staging.json",
    	},
    	"coordinator": {
    		"apiBaseUrl": "http://127.0.0.1:54321/functions/v1/perceo-coordinator",
    	},
    }
    ```

5. **Initialize Perceo in your project**

    ```bash
    perceo init
    ```

    - Generates `.perceo/config.json`.
    - Calls Observer Engine bootstrap if `observer.apiBaseUrl` is set.

6. **Run the full local loop**

    ```bash
    export PERCEO_ENV=local

    perceo watch --dev --analyze &
    perceo analytics sync &
    perceo dashboard --open
    ```

    - `watch` will eventually use `ObserverEngine.startWatchCore` for real-time flow detection.
    - `analytics sync` pulls latest production/staging metrics.
    - `dashboard` shows flows, metrics, and insights.

---

### 5. CI / GitHub Actions deployment

In CI you primarily use `perceo ci` commands backed by your managed services.

#### 5.1 Setup

1. Ensure `.perceo/config.json` is present in the repo with:
    - `flowGraph.endpoint` and `database` (Neo4j Aura / hosted).
    - `eventBus.type` and `redisUrl` (managed Redis).
    - `observer.apiBaseUrl` and `analyzer`/`analytics`/`coordinator` URLs.

2. In your CI system (GitHub Actions, GitLab CI, etc.), configure secrets:
    - `PERCEO_API_KEY`
    - `PERCEO_NEO4J_PASSWORD` (if needed)
    - `ANALYTICS_CREDENTIALS`

3. Install the CLI in your pipeline (e.g. `pnpm dlx @perceo/perceo` or via your monorepo build).

#### 5.2 Example GitHub Actions workflow

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
            PERCEO_API_KEY: ${{ secrets.PERCEO_API_KEY }}
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

            # Optional: consume perceo-impact.json to drive targeted test runs or PR annotations
```

You can also run `perceo ci` directly if the CLI is installed globally in the CI image.

---

### 6. Staging and production deployment patterns

Most teams use three tiers:

1. **Local dev**
    - Neo4j + Redis via Docker.
    - Supabase local stack (if self-hosting).
    - CLI on developer machines.
2. **Staging**
    - Managed Neo4j (Aura or small self-hosted cluster).
    - Managed Redis.
    - Supabase hosted project or Perceo Cloud staging environment.
    - Staging analytics properties (GA4/Mixpanel/Amplitude).
    - `PERCEO_ENV=staging` in CI and preview environments.
3. **Production**
    - Highly available Neo4j.
    - Managed Redis with HA.
    - Perceo Cloud or hardened Supabase project.
    - Production analytics credentials.
    - Scheduled `perceo analytics sync` and `perceo analyze insights` jobs.

For staging/production, your deployment platform (Kubernetes, ECS, serverless, etc.) should:

- Inject all Perceo-related secrets as environment variables.
- Mount `.perceo/config.json` from your repo.
- Optionally override with `PERCEO_CONFIG_PATH` when multiple projects run on the same cluster.

---

### 7. Operator checklists

#### 7.1 Local development ready when

- [ ] `.perceo/config.json` exists in the app repo.
- [ ] Neo4j is running and reachable (`bolt://localhost:7687`).
- [ ] (Optional) Redis is running (`redis://localhost:6379`).
- [ ] Supabase local stack (or equivalent) is up with Perceo functions.
- [ ] `.perceo/config.local.json` points to local services.
- [ ] `perceo init` completes and prints an Observer bootstrap summary (or a clear warning).
- [ ] `perceo ci analyze --base main --head HEAD` runs without connection errors.

#### 7.2 Production ready when

- [ ] Managed Neo4j endpoint and credentials are configured and reachable.
- [ ] Managed Redis is provisioned, secured, and reachable from engines + dashboard.
- [ ] Perceo Cloud or hosted Supabase APIs respond at the configured `apiBaseUrl`s.
- [ ] Analytics credentials for GA4/Mixpanel/Amplitude are wired via environment variables.
- [ ] CI pipelines use `perceo ci analyze` and (optionally) targeted `perceo ci test` based on impact.
- [ ] Scheduled analytics sync and insight jobs are configured (cron/scheduled tasks).

Once these checklists pass, your Perceo CLI, APIs, and services are fully deployed and ready to support both local development and production workflows.
