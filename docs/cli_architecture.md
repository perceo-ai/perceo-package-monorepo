# Perceo Unified CLI Architecture

**Version:** 2.0  
**Date:** February 12, 2026  
**Status:** Simplified Production Spec

---

## Executive Summary

This document defines how the Observer Engine, Analyzer Engine, and Analytics Correlation Engine integrate into a single, cohesive Perceo CLI using **only three managed services**: Vercel, Supabase, and Temporal Cloud.

**Core Integration Principle:** Each engine operates as an independent module with well-defined interfaces, orchestrated through Supabase Realtime and unified CLI command structure.

**Infrastructure Philosophy:** Maximize managed services, minimize operational complexity, ship fast.

---

## Simplified System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Perceo CLI (Unified Interface)                       │
│                         @perceo/perceo (npm)                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  perceo [command] [subcommand] [options]                                │
│                                                                          │
│  ├─ init          Initialize project                                    │
│  ├─ watch         Start development mode (Observer → Coordinator)       │
│  ├─ ci            CI/PR testing mode (Observer → Coordinator)           │
│  ├─ analyze       Run analyzer insights (Analyzer Engine)               │
│  ├─ analytics     Manage analytics integrations (Analytics Engine)      │
│  ├─ flows         Manage flow definitions                               │
│  ├─ dashboard     Launch local dashboard                                │
│  └─ config        Configuration management                              │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Vercel (Next.js App + API Routes)                    │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Dashboard UI                    API Routes                      │   │
│  │  - Flow visualization            - /api/observer/analyze         │   │
│  │  - Real-time metrics             - /api/analyzer/insights        │   │
│  │  - Analytics correlation         - /api/analytics/sync           │   │
│  │  - Test results                  - /api/flows/*                  │   │
│  │  - Insights feed                 - /api/webhooks/*               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Supabase (All Data + Realtime)                  │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  PostgreSQL Database                                             │   │
│  │  ├─ flows                    (flow definitions + graph data)     │   │
│  │  ├─ steps                    (flow steps as rows)                │   │
│  │  ├─ personas                 (user personas)                     │   │
│  │  ├─ test_runs                (test execution results)            │   │
│  │  ├─ analytics_events         (production events, partitioned)    │   │
│  │  ├─ insights                 (analyzer output)                   │   │
│  │  ├─ predictions              (failure predictions)               │   │
│  │  └─ flow_metrics             (synthetic + production metrics)    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Supabase Realtime (Event Bus Replacement)                       │   │
│  │  - Postgres CDC → Real-time subscriptions                        │   │
│  │  - Broadcast for ephemeral events                                │   │
│  │  - Presence for agent coordination                               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Supabase Storage                                                 │   │
│  │  - screenshots/              (agent screenshots)                 │   │
│  │  - videos/                   (test recordings)                   │   │
│  │  - reports/                  (generated reports)                 │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Supabase Auth                                                    │   │
│  │  - User authentication                                            │   │
│  │  - Project-level access control                                  │   │
│  │  - API key management                                             │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Temporal Cloud (Orchestration Only)                  │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Coordinator Workflows                                            │   │
│  │  - Test execution orchestration                                   │   │
│  │  - Multi-agent coordination                                       │   │
│  │  - Retry logic & error handling                                   │   │
│  │  - Long-running analytics jobs                                    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Worker Pool (Vercel Serverless Functions)                        │   │
│  │  - Playwright browser automation                                  │   │
│  │  - Computer use agents                                            │   │
│  │  - Screenshot capture                                             │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Three-Service Architecture

### 1. **Vercel** - Frontend + API Layer

**What it handles:**

- Next.js dashboard (UI)
- API routes for all engine operations
- Webhook receivers (GitHub, analytics providers)
- Temporal workers (serverless functions)

**Key API routes:**

```
/api/observer/analyze      → POST (analyze code changes)
/api/analyzer/insights     → GET  (fetch insights)
/api/analytics/sync        → POST (trigger sync)
/api/flows/[id]            → GET/PUT/DELETE
/api/webhooks/github       → POST (PR events)
/api/webhooks/analytics    → POST (GA4, Mixpanel)
```

**Why Vercel:**

- Zero-config deployments
- Serverless functions for Temporal workers
- Built-in CDN and edge network
- Automatic preview deployments for PRs

---

### 2. **Supabase** - All Data + Event Bus

**What it handles:**

- PostgreSQL database (all persistent data)
- Realtime subscriptions (replaces Redis event bus)
- Storage (screenshots, videos, reports)
- Auth (user + project access control)

#### Database Schema (PostgreSQL)

```sql
-- Personas
CREATE TABLE personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  behaviors jsonb,
  created_at timestamptz DEFAULT now()
);

-- Flows (graph representation as relational + JSONB)
CREATE TABLE flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  persona_id uuid REFERENCES personas(id),
  name text NOT NULL,
  description text,
  priority text CHECK (priority IN ('critical', 'high', 'medium', 'low')),

  -- Graph structure (simple for now)
  graph_data jsonb, -- Store complex graph relationships if needed

  -- Observer data
  affected_by_changes text[],
  risk_score float,

  -- Analyzer data
  coverage_score float,

  -- Metadata
  created_at timestamptz DEFAULT now(),
  last_modified timestamptz DEFAULT now(),

  UNIQUE(project_id, name)
);

-- Steps (ordered sequence per flow)
CREATE TABLE steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid REFERENCES flows(id) ON DELETE CASCADE,
  sequence_order int NOT NULL,
  name text NOT NULL,
  actions jsonb, -- [{type: 'click', target: '...'}]
  expected_state jsonb,
  timeout_ms int DEFAULT 5000,
  next_step_id uuid REFERENCES steps(id),

  UNIQUE(flow_id, sequence_order)
);

CREATE INDEX idx_steps_flow_order ON steps(flow_id, sequence_order);

-- Flow Metrics (synthetic + production)
CREATE TABLE flow_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid REFERENCES flows(id) ON DELETE CASCADE,

  -- Synthetic metrics (from tests)
  synthetic_success_rate float,
  synthetic_avg_duration_ms int,
  synthetic_last_run timestamptz,
  synthetic_run_count int DEFAULT 0,

  -- Production metrics (from analytics)
  prod_success_rate float,
  prod_daily_users int,
  prod_avg_duration_ms int,
  prod_top_exit_step text,
  prod_device_breakdown jsonb,
  prod_cohort_performance jsonb,
  prod_last_updated timestamptz,

  updated_at timestamptz DEFAULT now(),

  UNIQUE(flow_id)
);

-- Test Runs
CREATE TABLE test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid REFERENCES flows(id),
  status text CHECK (status IN ('pending', 'running', 'passed', 'failed', 'error')),
  duration_ms int,
  error_message text,
  screenshots jsonb, -- Array of storage URLs
  video_url text,
  logs jsonb,

  -- Context
  triggered_by text, -- 'pr', 'watch', 'manual'
  pr_number int,
  commit_sha text,

  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX idx_test_runs_flow ON test_runs(flow_id, created_at DESC);

-- Analytics Events (time-series, partitioned by month)
CREATE TABLE analytics_events (
  id uuid DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,

  event_type text NOT NULL,
  user_id text,
  session_id text,

  -- Flow matching
  flow_id uuid REFERENCES flows(id),
  flow_step text,
  flow_confidence float,

  -- Event data
  url text,
  metadata jsonb,
  device_type text,
  browser text,

  created_at timestamptz DEFAULT now(),

  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Create monthly partitions
CREATE TABLE analytics_events_2026_02 PARTITION OF analytics_events
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE INDEX idx_analytics_events_flow ON analytics_events(flow_id, created_at);
CREATE INDEX idx_analytics_events_session ON analytics_events(session_id, created_at);

-- Insights (from Analyzer)
CREATE TABLE insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid REFERENCES flows(id),
  type text CHECK (type IN ('discrepancy', 'coverage-gap', 'ux-issue', 'prediction')),
  severity text CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  message text NOT NULL,
  suggested_action text,

  -- Revenue impact estimation
  revenue_impact jsonb,

  -- Status
  status text DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),

  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX idx_insights_flow ON insights(flow_id, created_at DESC);
CREATE INDEX idx_insights_status ON insights(status, severity);

-- Predictions (from Analyzer ML model)
CREATE TABLE predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid REFERENCES flows(id),
  pr_number int,
  commit_sha text,

  probability float NOT NULL, -- 0-1
  confidence float NOT NULL, -- 0-1
  reasoning text,
  based_on text CHECK (based_on IN ('ml-model', 'heuristic', 'pattern')),

  -- Outcome (filled in after test runs)
  actual_result text CHECK (actual_result IN ('passed', 'failed', 'error')),

  created_at timestamptz DEFAULT now(),
  validated_at timestamptz
);

CREATE INDEX idx_predictions_flow ON predictions(flow_id, created_at DESC);

-- Projects (multi-tenancy)
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  framework text, -- 'nextjs', 'react', 'vue', etc.

  -- Config
  config jsonb,

  created_at timestamptz DEFAULT now(),

  UNIQUE(name)
);

-- Project members (via Supabase Auth)
CREATE TABLE project_members (
  project_id uuid REFERENCES projects(id),
  user_id uuid REFERENCES auth.users(id),
  role text CHECK (role IN ('owner', 'admin', 'member', 'viewer')),

  PRIMARY KEY (project_id, user_id)
);
```

#### Realtime Event Bus (Supabase Realtime)

**Replace Redis pub/sub with Supabase Realtime:**

```typescript
// Event publishing via Postgres INSERT + CDC
await supabase.from('events').insert({
  type: 'flows.affected',
  payload: {
    changeId: 'abc123',
    flows: [...]
  }
});

// Event subscription via Realtime
supabase
  .channel('perceo-events')
  .on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'events' },
    (payload) => {
      handleEvent(payload.new);
    }
  )
  .subscribe();

// Broadcast for ephemeral events (no persistence needed)
supabase.channel('test-progress')
  .on('broadcast', { event: 'test-update' }, (payload) => {
    updateProgress(payload);
  })
  .subscribe();
```

**Why Supabase Realtime:**

- Built-in with Supabase (no separate service)
- Postgres CDC for persistent events
- Broadcast channels for ephemeral messages
- Presence for agent coordination
- WebSocket + REST fallback

---

### 3. **Temporal Cloud** - Orchestration Only

**What it handles:**

- Test execution workflows
- Multi-agent coordination
- Retry logic and error handling
- Long-running analytics jobs

**Temporal Workflows:**

```typescript
// Coordinator workflow
@WorkflowMethod
async function runFlowTests(request: TestRequest): Promise<TestResult[]> {
  const flows = request.affectedFlows;

  // Parallel execution
  const results = await Promise.all(
    flows.map(flow =>
      executeChild(runSingleFlowTest, {
        args: [flow],
        taskQueue: 'perceo-agents'
      })
    )
  );

  return results;
}

// Single flow test workflow
@WorkflowMethod
async function runSingleFlowTest(flow: Flow): Promise<TestResult> {
  const agentId = generateId();

  // Activity: Spawn browser agent
  const agent = await activities.spawnAgent({
    flowId: flow.id,
    agentId
  });

  // Activity: Execute steps
  for (const step of flow.steps) {
    await activities.executeStep({
      agentId,
      step,
      retries: 3
    });
  }

  // Activity: Collect results
  const result = await activities.collectResults({ agentId });

  // Activity: Store in Supabase
  await activities.storeTestResult({
    flowId: flow.id,
    result
  });

  return result;
}
```

**Temporal Workers (Vercel Serverless Functions):**

```typescript
// api/temporal/worker.ts
import { Worker } from "@temporalio/worker";
import { Connection } from "@temporalio/client";

const connection = await Connection.connect({
	address: process.env.TEMPORAL_ADDRESS,
	tls: true,
});

const worker = await Worker.create({
	connection,
	namespace: "perceo-production",
	taskQueue: "perceo-agents",
	workflowsPath: require.resolve("./workflows"),
	activities: {
		spawnAgent: async (args) => {
			// Launch Playwright in serverless function
			const browser = await playwright.chromium.launch();
			// ... agent logic
		},
		executeStep: async (args) => {
			// Computer use / browser automation
		},
		storeTestResult: async (args) => {
			// Write to Supabase
			await supabase.from("test_runs").insert(args.result);
		},
	},
});

await worker.run();
```

**Why Temporal:**

- Handles complex orchestration (retries, timeouts, long-running)
- Durable execution (survives crashes)
- Workers run as Vercel serverless functions (no separate infrastructure)
- Built-in observability and debugging

---

## Data Flow Between Engines

### Flow 1: Code Change → Test Execution

```
Developer saves file (local) or opens PR (GitHub)
         │
         ▼
┌────────────────────────────────────────────────────────┐
│ Observer Engine (CLI or Webhook)                       │
│ - Detect change via git diff                           │
│ - Analyze with LLM (Claude API)                        │
│ - Pattern match against flows (Supabase query)         │
└────────┬───────────────────────────────────────────────┘
         │
         ▼ (Supabase INSERT)
┌────────────────────────────────────────────────────────┐
│ Supabase: flows table updated                          │
│ - affected_by_changes += [changeId]                    │
│ - risk_score = 0.87                                    │
└────────┬───────────────────────────────────────────────┘
         │
         ▼ (Realtime CDC event)
┌────────────────────────────────────────────────────────┐
│ Dashboard (subscribed to flows changes)                │
│ - Shows affected flows in real-time                    │
└────────────────────────────────────────────────────────┘
         │
         ▼ (API call to Temporal)
┌────────────────────────────────────────────────────────┐
│ Temporal Workflow: runFlowTests()                      │
│ - Coordinator spawns agents                            │
│ - Parallel execution                                   │
└────────┬───────────────────────────────────────────────┘
         │
         ▼ (Activities → Supabase)
┌────────────────────────────────────────────────────────┐
│ Supabase: test_runs table                              │
│ - INSERT results                                       │
│ - Storage: screenshots, videos                         │
└────────┬───────────────────────────────────────────────┘
         │
         ▼ (Realtime CDC event)
┌────────────────────────────────────────────────────────┐
│ Dashboard + CLI (subscribed)                           │
│ - Display results in real-time                         │
│ - Post comment to GitHub PR                            │
└────────────────────────────────────────────────────────┘
```

### Flow 2: Production Analytics → Insights

```
Production Analytics (GA4, Mixpanel, etc.)
         │
         ▼ (Webhook to Vercel)
┌────────────────────────────────────────────────────────┐
│ API Route: /api/webhooks/analytics                     │
│ - Receive event payload                                │
│ - Match to flows (sequence alignment)                  │
└────────┬───────────────────────────────────────────────┘
         │
         ▼ (Supabase INSERT)
┌────────────────────────────────────────────────────────┐
│ Supabase: analytics_events table                       │
│ - Store event with flow_id match                       │
│ - Partitioned by month                                 │
└────────┬───────────────────────────────────────────────┘
         │
         ▼ (Scheduled job via Vercel Cron)
┌────────────────────────────────────────────────────────┐
│ Analyzer Engine (Vercel API route)                     │
│ - Aggregate analytics_events                           │
│ - Calculate prod metrics                               │
│ - Compare synthetic vs production                      │
└────────┬───────────────────────────────────────────────┘
         │
         ▼ (Supabase UPDATE + INSERT)
┌────────────────────────────────────────────────────────┐
│ Supabase Updates:                                      │
│ - flow_metrics.prod_* fields updated                   │
│ - insights table: INSERT new discrepancy               │
└────────┬───────────────────────────────────────────────┘
         │
         ▼ (Realtime CDC event)
┌────────────────────────────────────────────────────────┐
│ Dashboard (subscribed)                                 │
│ - Alert: "27pt gap in Purchase flow"                  │
│ - Developer clicks → detailed breakdown                │
└────────────────────────────────────────────────────────┘
```

---

## Unified CLI Structure

### Core Commands

```bash
perceo
├── init                        # Interactive setup (Firebase-style)
├── watch                       # Development mode
│   ├── --dev                   # Local (default)
│   ├── --auto-test             # Run tests on save
│   └── --analyze               # Real-time insights
├── ci                          # CI/PR mode
│   ├── analyze                 # Analyze changes
│   ├── test                    # Run affected flows
│   └── report                  # Generate report
├── analyze                     # Analyzer commands
│   ├── insights                # Show insights
│   ├── coverage                # Coverage gaps
│   └── predict                 # Predict failures
├── analytics                   # Analytics commands
│   ├── connect                 # Connect provider
│   ├── sync                    # Manual sync
│   └── gaps                    # Untested flows
├── flows                       # Flow management
│   ├── list
│   ├── show <name>
│   ├── create
│   └── delete <name>
├── dashboard                   # Launch dashboard
└── config                      # Configuration
```

### Configuration

```jsonc
// .perceo/config.json

{
	"version": "2.0",
	"project": {
		"id": "uuid-from-supabase",
		"name": "my-app",
		"framework": "nextjs",
	},

	// Supabase connection
	"supabase": {
		"url": "${SUPABASE_URL}",
		"anonKey": "${SUPABASE_ANON_KEY}",
		"serviceRoleKey": "${SUPABASE_SERVICE_ROLE_KEY}", // For CLI only
	},

	// Temporal connection
	"temporal": {
		"address": "${TEMPORAL_ADDRESS}",
		"namespace": "perceo-production",
		"taskQueue": "perceo-agents",
	},

	// Vercel dashboard
	"dashboard": {
		"url": "https://app.perceo.dev", // Or localhost in dev
	},

	// Observer config
	"observer": {
		"watch": {
			"paths": ["app/", "src/"],
			"ignore": ["node_modules/", ".next/"],
			"debounceMs": 500,
		},
	},

	// Analyzer config
	"analyzer": {
		"insights": {
			"updateInterval": 3600, // 1 hour
			"minSeverity": "medium",
		},
	},

	// Analytics config
	"analytics": {
		"provider": "ga4",
		"syncInterval": 300, // 5 minutes
	},
}
```

---

## CLI Implementation

### Core CLI Entry Point

```typescript
// src/cli/index.ts
#!/usr/bin/env node

import { Command } from 'commander';
import { WatchCommand } from './commands/watch';
import { CICommand } from './commands/ci';
import { AnalyzeCommand } from './commands/analyze';
import { AnalyticsCommand } from './commands/analytics';
import { FlowsCommand } from './commands/flows';

const program = new Command();

program
  .name('perceo')
  .description('AI-powered regression testing')
  .version('1.0.0');

// Watch command
program
  .command('watch')
  .description('Start development mode')
  .option('--dev', 'Local development', true)
  .option('--auto-test', 'Run tests on save')
  .option('--analyze', 'Enable real-time insights')
  .action(async (options) => {
    const cmd = new WatchCommand();
    await cmd.execute(options);
  });

// CI command
const ci = program.command('ci').description('CI/PR mode');

ci.command('analyze')
  .option('--base <sha>', 'Base commit')
  .option('--head <sha>', 'Head commit')
  .option('--with-insights', 'Include predictions')
  .action(async (options) => {
    const cmd = new CICommand();
    await cmd.analyze(options);
  });

ci.command('test')
  .option('--flows-from <source>', 'analyze|all')
  .option('--parallel <n>', 'Parallelism', '5')
  .action(async (options) => {
    const cmd = new CICommand();
    await cmd.test(options);
  });

// ... more commands

program.parse();
```

### Watch Command (Observer Engine)

```typescript
// src/cli/commands/watch.ts

import chokidar from "chokidar";
import { createClient } from "@supabase/supabase-js";
import { analyzeChanges } from "../../observer/analyzer";

export class WatchCommand {
	async execute(options: WatchOptions): Promise<void> {
		const config = await loadConfig();
		const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

		// Subscribe to Supabase Realtime for test results
		supabase
			.channel("test-results")
			.on("postgres_changes", { event: "INSERT", schema: "public", table: "test_runs" }, (payload) => {
				const result = payload.new;
				const icon = result.status === "passed" ? "✅" : "❌";
				console.log(`${icon} ${result.flow_name}: ${result.status}`);
			})
			.subscribe();

		if (options.analyze) {
			// Subscribe to insights
			supabase
				.channel("insights")
				.on("postgres_changes", { event: "INSERT", schema: "public", table: "insights" }, (payload) => {
					const insight = payload.new;
					console.log(`💡 [${insight.severity}] ${insight.message}`);
				})
				.subscribe();
		}

		// Watch files
		const watcher = chokidar.watch(config.observer.watch.paths, {
			ignored: config.observer.watch.ignore,
			ignoreInitial: true,
		});

		console.log("🔍 Perceo Observer started");
		console.log(`📁 Watching: ${config.observer.watch.paths.join(", ")}\n`);

		watcher.on("change", async (path) => {
			console.log(`📝 Changed: ${path}`);

			// Analyze changes
			const diff = await getDiff(path);
			const analysis = await analyzeChanges(diff);

			// Update affected flows in Supabase
			for (const flow of analysis.affectedFlows) {
				await supabase
					.from("flows")
					.update({
						affected_by_changes: supabase.rpc("array_append", {
							arr: "affected_by_changes",
							elem: analysis.changeId,
						}),
						risk_score: flow.riskScore,
					})
					.eq("id", flow.id);
			}

			if (options.autoTest) {
				// Trigger tests via Temporal
				await triggerTests(analysis.affectedFlows);
			}
		});

		// Keep process alive
		await new Promise(() => {});
	}
}
```

### Analytics Sync (Analytics Engine)

```typescript
// src/cli/commands/analytics.ts

export class AnalyticsCommand {
	async executeSync(options: SyncOptions): Promise<void> {
		const config = await loadConfig();
		const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

		console.log("🔄 Syncing production data...");

		// Call Vercel API route
		const response = await fetch(`${config.dashboard.url}/api/analytics/sync`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${config.supabase.serviceRoleKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				provider: config.analytics.provider,
				since: await getLastSyncTimestamp(supabase),
			}),
		});

		const result = await response.json();

		console.log("✅ Sync complete");
		console.log(`   Events processed: ${result.eventsProcessed}`);
		console.log(`   Flows updated: ${result.flowsUpdated}`);

		// Subscribe to new insights
		const { data: insights } = await supabase.from("insights").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(5);

		if (insights && insights.length > 0) {
			console.log("\n💡 Recent insights:");
			for (const insight of insights) {
				console.log(`   • [${insight.severity}] ${insight.message}`);
			}
		}
	}
}
```

---

## Vercel API Routes

### Observer Analysis Endpoint

```typescript
// pages/api/observer/analyze.ts

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

export default async function handler(req, res) {
	const { baseSha, headSha, withInsights } = req.body;

	const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

	// Get diff
	const diff = await getDiff(baseSha, headSha);

	// Analyze with Claude
	const anthropic = new Anthropic({
		apiKey: process.env.ANTHROPIC_API_KEY,
	});

	const analysis = await anthropic.messages.create({
		model: "claude-sonnet-4-20250514",
		max_tokens: 2000,
		messages: [
			{
				role: "user",
				content: `Analyze this code diff and identify affected user flows:\n\n${diff}`,
			},
		],
	});

	// Get flows from Supabase
	const { data: flows } = await supabase.from("flows").select("*");

	// Match affected flows
	const affectedFlows = matchFlows(analysis, flows);

	// If predictions requested
	if (withInsights) {
		const predictions = await predictFailures(affectedFlows);

		// Store predictions
		await supabase.from("predictions").insert(
			predictions.map((p) => ({
				flow_id: p.flowId,
				probability: p.probability,
				confidence: p.confidence,
				reasoning: p.reasoning,
				commit_sha: headSha,
			})),
		);
	}

	res.json({
		changeId: generateId(),
		affectedFlows,
		predictions: withInsights ? predictions : undefined,
	});
}
```

### Analytics Sync Endpoint

```typescript
// pages/api/analytics/sync.ts

import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
	const { provider, since } = req.body;

	const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

	// Fetch events from analytics provider
	const connector = createConnector(provider);
	const events = await connector.fetchEvents({ since, limit: 10000 });

	// Match events to flows (sequence alignment)
	const { data: flows } = await supabase.from("flows").select("*");
	const matches = await matchEventsToFlows(events, flows);

	// Insert analytics events
	await supabase.from("analytics_events").insert(
		events.map((e) => ({
			project_id: req.user.projectId,
			event_type: e.type,
			flow_id: matches[e.id]?.flowId,
			flow_confidence: matches[e.id]?.confidence,
			metadata: e.metadata,
			created_at: e.timestamp,
		})),
	);

	// Update flow metrics
	for (const [flowId, metrics] of Object.entries(aggregateMetrics(matches))) {
		await supabase.from("flow_metrics").upsert({
			flow_id: flowId,
			prod_success_rate: metrics.successRate,
			prod_daily_users: metrics.dailyUsers,
			prod_avg_duration_ms: metrics.avgDuration,
			prod_last_updated: new Date().toISOString(),
		});
	}

	// Analyze discrepancies
	const insights = await analyzeDiscrepancies(supabase);

	// Insert insights
	if (insights.length > 0) {
		await supabase.from("insights").insert(insights);
	}

	res.json({
		eventsProcessed: events.length,
		flowsUpdated: Object.keys(matches).length,
		insightsGenerated: insights.length,
	});
}
```

---

## Temporal Workflows & Activities

### Coordinator Workflow

```typescript
// src/temporal/workflows/test-coordinator.ts

import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities";

const { spawnAgent, executeStep, collectResults, storeResults } = proxyActivities<typeof activities>({
	startToCloseTimeout: "5 minutes",
	retry: {
		maximumAttempts: 3,
	},
});

export async function runFlowTests(request: TestRequest): Promise<TestResult[]> {
	const results: TestResult[] = [];

	// Parallel execution
	for (const flow of request.flows) {
		const agentId = generateId();

		try {
			// Spawn browser agent
			await spawnAgent({ flowId: flow.id, agentId });

			// Execute steps
			for (const step of flow.steps) {
				await executeStep({
					agentId,
					step,
					retries: 3,
				});
			}

			// Collect results
			const result = await collectResults({ agentId });

			// Store in Supabase
			await storeResults({
				flowId: flow.id,
				result,
				prNumber: request.prNumber,
				commitSha: request.commitSha,
			});

			results.push(result);
		} catch (error) {
			results.push({
				flowId: flow.id,
				status: "error",
				error: error.message,
			});
		}
	}

	return results;
}
```

### Activities (Vercel Serverless Functions)

```typescript
// src/temporal/activities/index.ts

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function spawnAgent(args: { flowId: string; agentId: string }) {
	const browser = await chromium.launch({
		headless: true,
	});

	const context = await browser.newContext({
		viewport: { width: 1280, height: 720 },
		recordVideo: { dir: `/tmp/videos/${args.agentId}` },
	});

	const page = await context.newPage();

	// Store browser context
	global.agents = global.agents || {};
	global.agents[args.agentId] = { browser, context, page };

	return { agentId: args.agentId };
}

export async function executeStep(args: { agentId: string; step: Step; retries: number }) {
	const agent = global.agents[args.agentId];
	const { page } = agent;

	// Use Claude for computer use
	const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

	// Take screenshot
	const screenshot = await page.screenshot();

	// Ask Claude what to do
	const response = await anthropic.messages.create({
		model: "claude-sonnet-4-20250514",
		max_tokens: 1000,
		messages: [
			{
				role: "user",
				content: [
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/png",
							data: screenshot.toString("base64"),
						},
					},
					{
						type: "text",
						text: `Execute this step: ${args.step.name}\nActions: ${JSON.stringify(args.step.actions)}`,
					},
				],
			},
		],
		tools: [
			{
				type: "computer_20241022",
				name: "computer",
				display_width_px: 1280,
				display_height_px: 720,
			},
		],
	});

	// Execute tool calls
	for (const block of response.content) {
		if (block.type === "tool_use") {
			// Execute browser action
			await executeBrowserAction(page, block.input);
		}
	}

	return { success: true };
}

export async function collectResults(args: { agentId: string }) {
	const agent = global.agents[args.agentId];
	const { page, browser, context } = agent;

	// Final screenshot
	const screenshot = await page.screenshot();

	// Stop video recording
	await context.close();

	// Upload to Supabase Storage
	const { data: screenshotData } = await supabase.storage.from("screenshots").upload(`${args.agentId}/final.png`, screenshot);

	const videoPath = `/tmp/videos/${args.agentId}`;
	const { data: videoData } = await supabase.storage.from("videos").upload(`${args.agentId}/recording.webm`, fs.readFileSync(videoPath));

	await browser.close();
	delete global.agents[args.agentId];

	return {
		screenshot: screenshotData?.path,
		video: videoData?.path,
		status: "passed",
	};
}

export async function storeResults(args: { flowId: string; result: any; prNumber?: number; commitSha?: string }) {
	await supabase.from("test_runs").insert({
		flow_id: args.flowId,
		status: args.result.status,
		duration_ms: args.result.duration,
		screenshots: [args.result.screenshot],
		video_url: args.result.video,
		pr_number: args.prNumber,
		commit_sha: args.commitSha,
	});
}
```

---

## Deployment & Cost Estimate

### Monthly Costs

**Vercel:**

- Free tier: $0 (for personal projects)
- Pro: $20/month (for teams)

**Supabase:**

- Pro: $25/month
    - 8 GB database
    - 100 GB bandwidth
    - 100 GB file storage

**Temporal Cloud:**

- Starter: $200/month
    - 200 actions/second
    - Unlimited workflows

**Total: ~$245/month** (with Vercel Pro)
**Total: ~$225/month** (with Vercel Free)

### Scaling Plan

**Month 1-3 (MVP):**

- Vercel Free + Supabase Pro + Temporal Starter
- Support 10 projects, 100 flows, 1000 tests/day
- Cost: ~$225/month

**Month 4-6 (Early customers):**

- Vercel Pro + Supabase Pro + Temporal Growth
- Support 50 projects, 500 flows, 10k tests/day
- Cost: ~$500/month

**Month 7+ (Scale):**

- Evaluate dedicated infrastructure
- Consider self-hosted Temporal
- Supabase Team plan if needed

---

## Next Steps (Week-by-Week)

### Week 1: Foundation

- [ ] Set up Supabase project
- [ ] Define database schema (run migrations)
- [ ] Create Vercel Next.js app
- [ ] Set up Temporal Cloud namespace
- [ ] Build CLI skeleton with Commander.js

### Week 2: Observer Engine

- [ ] Implement file watching (Chokidar)
- [ ] Git diff analysis
- [ ] Claude API integration for change classification
- [ ] Supabase write operations
- [ ] `perceo watch` command

### Week 3: Coordinator + Agents

- [ ] Temporal workflows
- [ ] Playwright activities
- [ ] Computer use integration
- [ ] Supabase storage uploads
- [ ] `perceo ci test` command

### Week 4: Analytics Engine

- [ ] GA4 connector
- [ ] Event matching algorithm
- [ ] Metrics aggregation
- [ ] Supabase analytics queries
- [ ] `perceo analytics sync` command

### Week 5: Analyzer Engine

- [ ] Discrepancy detection
- [ ] Insight generation
- [ ] ML prediction model (simple heuristics first)
- [ ] `perceo analyze insights` command

### Week 6: Dashboard

- [ ] Next.js UI with Supabase Realtime
- [ ] Flow visualization
- [ ] Test results view
- [ ] Analytics correlation view
- [ ] Insights feed

### Week 7-8: Polish & Demo

- [ ] End-to-end testing
- [ ] Documentation
- [ ] Demo video
- [ ] YC prep

---

## Summary

**Three services. Zero complexity.**

- **Vercel**: Dashboard + API + Temporal workers
- **Supabase**: All data + Realtime event bus + Storage + Auth
- **Temporal**: Orchestration only

**No Redis. No Neo4j. No separate backend.**

Graph data lives in Postgres JSONB. Event bus is Supabase Realtime. Everything deploys with `git push`.

**Ship in 6-8 weeks. Prove the concept. Add infrastructure when needed, not before.**
