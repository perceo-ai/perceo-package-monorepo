## Perceo CLI Managed Services Setup

**Version:** 1.0  
**Date:** February 12, 2026  
**Status:** Operator Runbook (Local + Production)

---

### 1. What “managed services” does the CLI architecture need?

The unified CLI architecture expects the following external services to exist. The CLI itself is **just the orchestrator**; engines and state live outside of the npm package.

- **Flow Graph Database (Neo4j)**
    - Stores flows, personas, synthetic test results, production metrics, and analyzer insights.
    - Used by: Observer Engine, Analyzer Engine, Analytics Engine, Coordinator, Dashboard.

- **Event Bus (Redis / in-memory)**
    - Connects engines and coordinator through pub/sub events.
    - Used by: all engines and the CLI for cross‑component communication.

- **Perceo Managed APIs (Observer / Analyzer / Analytics / Coordinator)**
    - Actual “brains” of the system, exposed as HTTP/GraphQL APIs.
    - Backed by: Supabase (Postgres + Auth + Edge Functions) or Perceo Cloud.

- **External Analytics Providers (GA4, Mixpanel, Amplitude, etc.)**
    - Source of truth for production behaviour and revenue metrics.
    - Connected by: Analytics Engine.

This document explains how to stand each of these up **locally** and what a **production‑grade** deployment looks like.

---

### 2. Flow Graph Database (Neo4j)

#### 2.1. Local development (Docker)

**Goal:** Run a local Neo4j instance the engines can use during development.

```bash
docker run \
  --name perceo-neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/test1234 \
  neo4j:5
```

Recommended local config snippet in `.perceo/config.local.json`:

```jsonc
{
	"flowGraph": {
		"endpoint": "bolt://localhost:7687",
		"database": "PerceoDev",
	},
}
```

Usage:

- Visit `http://localhost:7474` to verify the DB is up.
- Use `neo4j / test1234` to log in, then create the `PerceoDev` database if needed.

#### 2.2. Production deployment

You have two main options:

- **Neo4j Aura / managed Neo4j service**
    - Pros: fully managed, backups, security, monitoring.
    - Cons: additional cost.

- **Self‑hosted Neo4j (Kubernetes or VMs)**
    - Pros: full control, can colocate with other infra.
    - Cons: you manage availability, upgrades, and backups.

Example production snippet in `.perceo/config.json`:

```jsonc
{
	"flowGraph": {
		"endpoint": "neo4j+s://<your-neo4j-host>:7687",
		"database": "Perceo",
		"username": "perceo_app",
		"password": "${PERCEO_NEO4J_PASSWORD}",
	},
}
```

**Notes:**

- Use environment variables (e.g. `PERCEO_NEO4J_PASSWORD`) rather than hard‑coding credentials.
- Restrict inbound access to your app/engines network or VPC only.

---

### 3. Event Bus (Redis / in‑memory)

The event bus is configured via `eventBus` in `.perceo/config.json`.

#### 3.1. Local development (in‑memory or Docker Redis)

**Simplest:** in‑memory only (no external service).

```jsonc
{
	"eventBus": {
		"type": "in-memory",
	},
}
```

**Distributed/local multi‑process:** Redis via Docker:

```bash
docker run -d --name perceo-redis -p 6379:6379 redis:7
```

```jsonc
{
	"eventBus": {
		"type": "redis",
		"redisUrl": "redis://localhost:6379",
	},
}
```

Use Redis locally when:

- You’re running engines in separate processes/containers.
- You want your local setup to mirror production topology more closely.

#### 3.2. Production deployment

Use a **managed Redis** or **Redis‑compatible** service:

- AWS ElastiCache for Redis
- GCP Memorystore for Redis
- Azure Cache for Redis
- Serverless options such as Upstash

Example production config:

```jsonc
{
	"eventBus": {
		"type": "redis",
		"redisUrl": "rediss://<your-redis-endpoint>:6379",
	},
}
```

Best practices:

- Prefer TLS (`rediss://`) endpoints.
- Use Redis ACLs or per‑app credentials.
- Isolate Redis into a private network/VPC where only engines and the dashboard can reach it.

---

### 4. Perceo Managed APIs (Observer / Analyzer / Analytics / Coordinator)

The CLI is designed so that Observer, Analyzer, Analytics, and Coordinator engines can live **behind managed APIs** instead of being bundled in the CLI.

You can run these either:

- In **Perceo Cloud** (recommended for production), or
- In your own **Supabase project** for local or self‑hosted environments.

#### 4.1. Local development with Supabase

**Goal:** Stand up a Supabase project that mimics Perceo’s managed APIs.

1. Install the Supabase CLI:  
   See Supabase’s official docs for your platform.

2. Initialize a new project (in a separate folder from your app):

```bash
mkdir perceo-services
cd perceo-services
supabase init
supabase start
```

This starts:

- Local Postgres
- Auth
- Edge Functions runtime
- Studio UI

3. Create Perceo‑specific schemas/tables/functions:

- **Postgres**: tables for events, metrics, model state, and configuration.
- **Edge Functions**: HTTP/GraphQL endpoints for:
    - Observer Engine APIs (e.g. ingest change analysis, affected flows)
    - Analyzer Engine APIs (e.g. fetch insights, update ML models)
    - Analytics Engine APIs (e.g. ingest GA4/Mixpanel events, correlate to flows)
    - Coordinator APIs (e.g. start/track test executions)

4. Configure the CLI and engines to talk to your local Supabase:

```jsonc
{
	"analytics": {
		"provider": "ga4",
		"credentials": "file:./secrets/ga4-local.json",
		"syncInterval": 300,
		"apiBaseUrl": "http://127.0.0.1:54321/functions/v1/perceo-analytics",
	},
	"observer": {
		"apiBaseUrl": "http://127.0.0.1:54321/functions/v1/perceo-observer",
	},
	"analyzer": {
		"apiBaseUrl": "http://127.0.0.1:54321/functions/v1/perceo-analyzer",
	},
	"coordinator": {
		"apiBaseUrl": "http://127.0.0.1:54321/functions/v1/perceo-coordinator",
	},
}
```

These URLs are examples; align them with however you name your edge functions.

#### 4.2. Production deployment with Perceo Cloud or Supabase

**Option A: Perceo Cloud (recommended)**

- Engines and APIs are fully managed by Perceo.
- You typically receive:
    - A **Perceo Cloud base URL** (e.g. `https://api.perceo.dev`)
    - A **project ID** and **API key**
    - Optionally, environment‑specific endpoints (`staging`, `production`).

Example production config:

```jsonc
{
	"observer": {
		"apiBaseUrl": "https://api.perceo.dev/observer",
		"apiKey": "${PERCEO_API_KEY}",
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

**Option B: Self‑hosted Supabase (production)**

- Promote your local Supabase project to a managed Supabase project.
- Deploy edge functions and database migrations to a hosted environment.
- Lock down network access so only your app and engines can hit the APIs.

Config is identical to the local Supabase example, but with hosted URLs:

```jsonc
{
	"observer": {
		"apiBaseUrl": "https://<your-supabase-project>.functions.supabase.co/perceo-observer",
		"apiKey": "${PERCEO_SUPABASE_SERVICE_KEY}",
	},
}
```

---

### 5. External Analytics Providers (GA4, Mixpanel, Amplitude)

The Analytics Engine integrates production analytics into the flow graph.

#### 5.1. Local / staging setup

1. Create a **separate analytics property or project** (e.g. a GA4 property for staging).
2. Generate service credentials for server‑side access:
    - GA4: service account JSON with the `analytics.readonly` scope.
    - Mixpanel/Amplitude: project‑level API keys.
3. Store credentials outside of git:

```bash
mkdir -p .perceo/secrets
cp path/to/ga4-staging.json .perceo/secrets/ga4-staging.json
```

4. Point `.perceo/config.local.json` at those credentials:

```jsonc
{
	"analytics": {
		"provider": "ga4",
		"credentials": "file:.perceo/secrets/ga4-staging.json",
	},
}
```

#### 5.2. Production setup

1. Use production properties/projects (GA4, Mixpanel, Amplitude).
2. Create production service credentials.
3. Inject them via environment variables in your engine/Perceo Cloud configuration (never commit raw keys).

Example:

```jsonc
{
	"analytics": {
		"provider": "ga4",
		"credentials": "${ANALYTICS_CREDENTIALS}", // JSON or key string
		"syncInterval": 300,
		"correlation": {
			"algorithm": "smith-waterman",
			"minSimilarity": 0.7,
		},
	},
}
```

In your deployment platform, set `ANALYTICS_CREDENTIALS` to the actual key or JSON string.

---

### 6. Environment configuration model

The CLI already supports a layered config model:

- **Base config:** `.perceo/config.json` (checked into your app repo).
- **Local overrides:** `.perceo/config.local.json` (git‑ignored).
- **Environment variables:**
    - `PERCEO_ENV=local|dev|staging|production`
    - `PERCEO_CONFIG_PATH=/path/to/custom/config.json`

Resolution rules:

- CLI reads `.perceo/config.json` by default.
- If `PERCEO_ENV=local` and `.perceo/config.local.json` exists, it is **deep‑merged on top of** base config.
- `PERCEO_CONFIG_PATH` overrides the path entirely.

This lets you:

- Put **production endpoints** and defaults in `config.json`.
- Keep **local Docker/Supabase/credential paths** in `config.local.json`.
- Use environment variables for any **secrets or environment‑specific URLs**.

---

### 7. Example end‑to‑end setups

#### 7.1. Purely local development (everything on your machine)

1. Start Neo4j:

```bash
docker run \
  --name perceo-neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/test1234 \
  neo4j:5
```

2. Start Redis (optional but recommended):

```bash
docker run -d --name perceo-redis -p 6379:6379 redis:7
```

3. Start local Supabase services:

```bash
cd perceo-services
supabase start
```

4. Configure `.perceo/config.local.json` to point at:

- `bolt://localhost:7687` for Neo4j
- `redis://localhost:6379` for Redis
- `http://127.0.0.1:54321` for Supabase functions
- local analytics credentials

5. Run the full loop:

```bash
export PERCEO_ENV=local
perceo watch --dev --analyze &
perceo analytics sync &
perceo dashboard --open
```

#### 7.2. Hybrid dev: local CLI + cloud services

Use this when you want **Perceo Cloud / hosted services** but still run the CLI on your laptop.

- Neo4j: Neo4j Aura
- Event bus: managed Redis
- Engines & APIs: Perceo Cloud
- Analytics: production or staging GA4 / Mixpanel

Config highlights:

```jsonc
{
	"flowGraph": {
		"endpoint": "neo4j+s://<aura-host>:7687",
		"database": "Perceo",
	},
	"eventBus": {
		"type": "redis",
		"redisUrl": "rediss://<managed-redis-host>:6379",
	},
	"observer": {
		"apiBaseUrl": "https://api.perceo.dev/observer",
		"apiKey": "${PERCEO_API_KEY}",
	},
}
```

Then:

```bash
perceo watch --dev --analyze
```

The CLI orchestrates everything, but all heavy lifting happens in managed services.

#### 7.3. Full production deployment

In production you want:

- **Managed Neo4j** (Aura or self‑hosted with HA)
- **Managed Redis** for the event bus
- **Perceo Cloud or hosted Supabase** for all engines
- **Production analytics properties and credentials**

Typical flow:

1. Provision Neo4j, Redis, Perceo Cloud/Supabase, and analytics credentials.
2. Create `.perceo/config.json` with production endpoints (no secrets).
3. Inject secrets via environment variables in your deployment platform.
4. Use `perceo ci` and scheduled `perceo analytics` / `perceo analyze` commands in your CI/CD and cron/schedulers.

---

### 8. Operator checklist

- **Local dev ready when:**
    - [ ] Neo4j (Docker) is running and reachable.
    - [ ] (Optional) Redis is running and configured.
    - [ ] Supabase project is up with Perceo edge functions and tables.
    - [ ] `.perceo/config.local.json` points to local services.
    - [ ] `perceo watch --dev --analyze` starts without connection errors.

- **Production ready when:**
    - [ ] Managed Neo4j endpoint and creds are configured.
    - [ ] Managed Redis is provisioned and secured.
    - [ ] Perceo Cloud or hosted Supabase APIs are reachable from your app/CI.
    - [ ] Analytics credentials for GA4/Mixpanel/Amplitude are wired via env vars.
    - [ ] CI workflows (`perceo ci`) and scheduled jobs (`perceo analytics sync`, `perceo analyze insights`) are in place.
