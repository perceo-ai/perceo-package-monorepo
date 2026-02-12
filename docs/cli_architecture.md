# Perceo Unified CLI Architecture

**Version:** 1.0  
**Date:** February 11, 2026  
**Status:** Integration Specification

---

## Executive Summary

This document defines how the Observer Engine, Analyzer Engine, and Analytics Correlation Engine integrate into a single, cohesive Perceo CLI. The architecture ensures seamless data flow between components while maintaining clear separation of concerns and enabling independent development/deployment.

**Core Integration Principle:** Each engine operates as an independent module with well-defined interfaces, orchestrated through a central event bus and unified CLI command structure.

---

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Perceo CLI (Unified Interface)                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Perceo [command] [subcommand] [options]                             │
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
│                         Central Event Bus (Redis/In-Memory)              │
│  - Pub/Sub for real-time events                                         │
│  - Event replay for debugging                                           │
│  - Cross-engine communication                                           │
└─────────────────────────────────────────────────────────────────────────┘
          │                         │                         │
          ▼                         ▼                         ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────────┐
│ Observer Engine  │   │ Analyzer Engine  │   │ Analytics Engine     │
│                  │   │                  │   │                      │
│ - File Monitor   │   │ - Flow Analysis  │   │ - Data Ingestion     │
│ - Change Detect  │   │ - UX Insights    │   │ - Sequence Alignment │
│ - Pattern Match  │   │ - Coverage Gaps  │   │ - Correlation Logic  │
│ - LLM Classify   │   │ - Predictions    │   │ - Anomaly Detection  │
│ - Impact Analyze │   │ - Root Cause     │   │ - Revenue Impact     │
└────────┬─────────┘   └────────┬─────────┘   └──────────┬───────────┘
         │                      │                         │
         └──────────────────────┼─────────────────────────┘
                                ▼
                   ┌─────────────────────────┐
                   │   Flow Graph Database   │
                   │       (Neo4j)           │
                   │                         │
                   │ - Flows & Steps         │
                   │ - Personas              │
                   │ - Test Results          │
                   │ - Production Metrics    │
                   │ - Analysis Insights     │
                   └────────┬────────────────┘
                            │
                            ▼
                   ┌─────────────────────────┐
                   │  Coordinator Agent      │
                   │  (Temporal Workflows)   │
                   │                         │
                   │ - Test Orchestration    │
                   │ - Agent Swarm Mgmt      │
                   │ - Results Collection    │
                   └─────────────────────────┘
```

---

## Data Flow Between Engines

### Flow 1: Code Change → Test Execution (Observer → Coordinator)

```
Developer saves file
         │
         ▼
┌────────────────────┐
│ Observer Engine    │
│ - Detect change    │
│ - Analyze diff     │
│ - Pattern match    │
│ - LLM classify     │
└────────┬───────────┘
         │
         ▼ (publishes event)
┌────────────────────────────────┐
│ Event: "flows.affected"        │
│ {                              │
│   changeId: "abc123",          │
│   flows: [                     │
│     {                          │
│       name: "Purchase Product",│
│       confidence: 0.92,        │
│       riskScore: 0.87,         │
│       priority: "high"         │
│     }                          │
│   ],                           │
│   changes: [...],              │
│   timestamp: ...               │
│ }                              │
└────────┬───────────────────────┘
         │
         ▼ (coordinator subscribes)
┌────────────────────┐
│ Coordinator Agent  │
│ - Receive event    │
│ - Plan execution   │
│ - Spawn agents     │
│ - Run tests        │
└────────┬───────────┘
         │
         ▼ (publishes results)
┌────────────────────────────────┐
│ Event: "tests.completed"       │
│ {                              │
│   changeId: "abc123",          │
│   results: [...],              │
│   passed: 4,                   │
│   failed: 1,                   │
│   duration: 45200              │
│ }                              │
└────────┬───────────────────────┘
         │
         ├──────────────┬──────────────────┐
         ▼              ▼                  ▼
  [Analyzer]      [Analytics]        [Dashboard]
  (subscribes)    (subscribes)       (subscribes)
```

### Flow 2: Production Data → Flow Insights (Analytics → Analyzer → Observer)

```
Production Analytics (GA4, Mixpanel, etc.)
         │
         ▼ (webhook/polling)
┌────────────────────┐
│ Analytics Engine   │
│ - Ingest events    │
│ - Match to flows   │
│ - Calculate metrics│
└────────┬───────────┘
         │
         ▼ (writes to graph)
┌────────────────────────────────┐
│ Flow Graph DB Update           │
│ flow.productionMetrics = {     │
│   successRate: 0.67,           │
│   dailyUsers: 2847,            │
│   topExitStep: "add-to-cart",  │
│   deviceBreakdown: {...}       │
│ }                              │
└────────┬───────────────────────┘
         │
         ▼ (triggers analysis)
┌────────────────────┐
│ Analyzer Engine    │
│ - Detect discrepancy│
│ - Compare synthetic│
│   vs production    │
│ - Generate insight │
└────────┬───────────┘
         │
         ▼ (publishes event)
┌────────────────────────────────┐
│ Event: "insights.new"          │
│ {                              │
│   type: "discrepancy",         │
│   severity: "medium",          │
│   flow: "Purchase Product",    │
│   message: "27pt gap between   │
│     synthetic (94%) and real   │
│     (67%) success rates",      │
│   suggestedAction: "Add mobile │
│     test scenario"             │
│ }                              │
└────────┬───────────────────────┘
         │
         ├──────────────┬──────────────────┐
         ▼              ▼                  ▼
  [Dashboard]      [Observer]         [Developer]
  (displays)       (suggests flow)    (notification)
```

### Flow 3: Analyzer Insights → Observer Pattern Updates (Feedback Loop)

```
┌────────────────────┐
│ Analyzer Engine    │
│ - Detects new      │
│   pattern:         │
│   "Quick Reorder"  │
│   (376 users/week) │
└────────┬───────────┘
         │
         ▼ (publishes event)
┌────────────────────────────────┐
│ Event: "flows.discovered"      │
│ {                              │
│   flowName: "Quick Reorder",   │
│   confidence: 0.78,            │
│   basedOn: "production-data",  │
│   pattern: [...steps...],      │
│   usage: {                     │
│     weeklyUsers: 376,          │
│     avgDuration: "12s"         │
│   }                            │
│ }                              │
└────────┬───────────────────────┘
         │
         ▼ (observer subscribes)
┌────────────────────┐
│ Observer Engine    │
│ - Adds pattern to  │
│   matcher library  │
│ - Now watches for  │
│   related code     │
│   changes          │
└────────────────────┘
         │
         ▼ (next code change)
┌────────────────────────────────┐
│ Developer modifies quick-      │
│ reorder button                 │
│         │                      │
│         ▼                      │
│ Observer detects & matches     │
│ "Quick Reorder" pattern        │
│ (confidence: 0.91)             │
└────────────────────────────────┘
```

---

## Unified CLI Structure

### Command Hierarchy

```bash
perceo
├── init                        # Interactive project setup (Firebase-style)
│   # Detects framework when possible, then walks you through:
│   # - Selecting framework/stack
│   # - Choosing which Perceo features to enable (watch, ci, analytics, dashboard)
│   # - Generating .perceo/config.json and minimal boilerplate
│
├── watch                       # Development mode (Observer-driven)
│   ├── --dev                   # Local development (default)
│   ├── --auto-test             # Run tests on changes
│   └── --analyze               # Enable real-time analyzer insights
│
├── ci                          # CI mode (Observer-driven)
│   ├── analyze                 # Analyze PR changes
│   │   ├── --base <sha>
│   │   ├── --head <sha>
│   │   └── --with-insights     # Include analyzer predictions
│   ├── test                    # Run affected flows
│   │   ├── --flows-from <source>
│   │   └── --parallel <n>
│   └── report                  # Generate test report
│       └── --format json|html
│
├── analyze                     # Analyzer Engine commands
│   ├── insights                # Show current insights
│   │   ├── --flow <name>       # For specific flow
│   │   └── --severity <level>  # Filter by severity
│   ├── coverage                # Coverage gap analysis
│   ├── suggest                 # Suggest flow improvements
│   └── predict                 # Predict failure likelihood
│       └── --for-pr <number>
│
├── analytics                   # Analytics Engine commands
│   ├── connect                 # Connect analytics source
│   │   ├── --provider ga4|mixpanel|amplitude
│   │   └── --credentials <path>
│   ├── sync                    # Manual sync production data
│   ├── correlate               # Run correlation analysis
│   │   └── --flow <name>
│   ├── gaps                    # Show untested flows from prod
│   └── impact                  # Revenue impact estimation
│       └── --flow <name>
│
├── flows                       # Flow management
│   ├── list                    # List all flows
│   ├── show <name>             # Show flow details
│   │   └── --with-metrics      # Include prod metrics
│   ├── create                  # Create new flow
│   ├── edit <name>             # Edit flow definition
│   └── delete <name>           # Delete flow
│
├── dashboard                   # Launch dashboard
│   ├── --port <port>           # Local dashboard port
│   └── --open                  # Auto-open browser
│
└── config                      # Configuration
    ├── get <key>
    ├── set <key> <value>
    └── show                    # Show all config
```

### Command Examples

```bash
# Setup (interactive, similar to `firebase init`)
perceo init

# Development workflow
perceo watch --dev --analyze
# → Starts Observer (file watching)
# → Enables real-time Analyzer insights
# → Runs tests on code changes

# CI workflow
perceo ci analyze --base main --head HEAD --with-insights
# → Observer analyzes changes
# → Analyzer predicts failure likelihood
# → Outputs affected flows + risk scores

perceo ci test --flows-from analyze --parallel 5
# → Coordinator runs tests based on Observer's analysis
# → Results feed back to Analyzer for learning

# Analytics workflow
perceo analytics connect --provider ga4
# → Configure GA4 integration
# → Start ingesting production data

perceo analytics sync
# → Manually trigger sync
# → Analytics Engine fetches latest data
# → Correlates with flow definitions

perceo analytics gaps
# → Analyzer + Analytics collaboration
# → Show flows that exist in prod but not in tests

# Insights workflow
perceo analyze insights --severity high
# → Show high-severity insights from Analyzer
# → Includes discrepancies from Analytics Engine
# → Suggests actions

perceo analyze predict --for-pr 123
# → Analyzer uses:
#   - Observer's change analysis
#   - Analytics' production metrics
#   - Historical patterns
# → Predicts failure probability

# Combined workflow
perceo watch --dev --analyze &
perceo analytics sync &
perceo dashboard --open
# → All engines running
# → Real-time insights in dashboard
```

---

## Event Bus Specification

### Core Events

```typescript
// src/core/events.ts

export enum EventType {
	// Observer events
	CHANGE_DETECTED = "observer.change.detected",
	FLOWS_AFFECTED = "observer.flows.affected",
	ANALYSIS_COMPLETE = "observer.analysis.complete",

	// Coordinator events
	TESTS_STARTED = "coordinator.tests.started",
	TESTS_COMPLETED = "coordinator.tests.completed",
	TEST_FAILED = "coordinator.test.failed",

	// Analytics events
	DATA_SYNCED = "analytics.data.synced",
	METRICS_UPDATED = "analytics.metrics.updated",
	CORRELATION_COMPLETE = "analytics.correlation.complete",

	// Analyzer events
	INSIGHT_GENERATED = "analyzer.insight.generated",
	FLOW_DISCOVERED = "analyzer.flow.discovered",
	PREDICTION_MADE = "analyzer.prediction.made",
	ANOMALY_DETECTED = "analyzer.anomaly.detected",

	// Flow Graph events
	FLOW_CREATED = "graph.flow.created",
	FLOW_UPDATED = "graph.flow.updated",
	FLOW_DELETED = "graph.flow.deleted",
}

export interface PerceoEvent<T = any> {
	id: string;
	type: EventType;
	timestamp: number;
	source: "observer" | "coordinator" | "analytics" | "analyzer" | "graph";
	data: T;
	metadata?: {
		userId?: string;
		projectId?: string;
		environment?: string;
	};
}
```

### Event Bus Implementation

```typescript
// src/core/event-bus.ts

import { EventEmitter } from "events";
import Redis from "ioredis";

export class EventBus extends EventEmitter {
	private redis?: Redis;
	private subscriptions: Map<string, Set<EventHandler>> = new Map();

	constructor(config: EventBusConfig) {
		super();

		if (config.useRedis) {
			this.redis = new Redis(config.redisUrl);
			this.setupRedisSubscriptions();
		}
	}

	async publish<T>(event: PerceoEvent<T>): Promise<void> {
		// Emit locally
		this.emit(event.type, event);

		// Publish to Redis for distributed systems
		if (this.redis) {
			await this.redis.publish("Perceo:events", JSON.stringify(event));
		}

		// Log for debugging
		console.log(`[EventBus] Published: ${event.type}`, event.data);
	}

	subscribe<T>(eventType: EventType | EventType[], handler: EventHandler<T>): void {
		const types = Array.isArray(eventType) ? eventType : [eventType];

		for (const type of types) {
			if (!this.subscriptions.has(type)) {
				this.subscriptions.set(type, new Set());
			}
			this.subscriptions.get(type)!.add(handler);
			this.on(type, handler);
		}
	}

	unsubscribe<T>(eventType: EventType, handler: EventHandler<T>): void {
		this.subscriptions.get(eventType)?.delete(handler);
		this.off(eventType, handler);
	}

	private setupRedisSubscriptions(): void {
		if (!this.redis) return;

		const subscriber = this.redis.duplicate();
		subscriber.subscribe("Perceo:events");

		subscriber.on("message", (channel, message) => {
			try {
				const event = JSON.parse(message) as PerceoEvent;
				this.emit(event.type, event);
			} catch (error) {
				console.error("Failed to parse event:", error);
			}
		});
	}
}

interface EventBusConfig {
	useRedis?: boolean;
	redisUrl?: string;
}

type EventHandler<T = any> = (event: PerceoEvent<T>) => void | Promise<void>;
```

---

## Engine Integration Points

### Observer Engine Exports

```typescript
// src/observer/index.ts

export class ObserverEngine {
	constructor(
		private eventBus: EventBus,
		private flowGraph: FlowGraphClient,
		private config: ObserverConfig,
	) {}

	// Called by CLI: Perceo watch
	async startWatch(): Promise<void> {
		const monitor = new FileMonitor(this.config.watch);

		monitor.on("change", async (change) => {
			// Analyze change
			const analysis = await this.analyzeChange(change);

			// Publish event
			await this.eventBus.publish({
				id: generateId(),
				type: EventType.FLOWS_AFFECTED,
				timestamp: Date.now(),
				source: "observer",
				data: {
					changeId: analysis.id,
					flows: analysis.affectedFlows,
					changes: analysis.changes,
				},
			});
		});

		await monitor.start();
	}

	// Called by CLI: Perceo ci analyze
	async analyzeChanges(baseSha: string, headSha: string): Promise<ImpactReport> {
		// Get diff
		const diff = await this.getDiff(baseSha, headSha);

		// Analyze
		const analysis = await this.changeAnalyzer.analyze(diff);
		const impacts = await this.impactAnalyzer.analyze(analysis);

		// Publish event
		await this.eventBus.publish({
			id: generateId(),
			type: EventType.ANALYSIS_COMPLETE,
			timestamp: Date.now(),
			source: "observer",
			data: impacts,
		});

		return impacts;
	}

	// Subscribe to analyzer insights
	subscribeToInsights(): void {
		this.eventBus.subscribe(EventType.FLOW_DISCOVERED, async (event) => {
			// Add newly discovered flow pattern to matcher
			await this.patternMatcher.addPattern(event.data.pattern);
		});
	}
}
```

### Analyzer Engine Exports

```typescript
// src/analyzer/index.ts

export class AnalyzerEngine {
	constructor(
		private eventBus: EventBus,
		private flowGraph: FlowGraphClient,
		private config: AnalyzerConfig,
	) {
		this.subscribeToEvents();
	}

	// Called by CLI: Perceo analyze insights
	async getInsights(filter?: InsightFilter): Promise<Insight[]> {
		const flows = await this.flowGraph.getAllFlows();
		const insights: Insight[] = [];

		for (const flow of flows) {
			// Flow completeness analysis
			insights.push(...(await this.analyzeCompleteness(flow)));

			// UX optimization analysis
			insights.push(...(await this.analyzeUX(flow)));

			// Coverage gap analysis
			insights.push(...(await this.analyzeCoverage(flow)));
		}

		return this.filterAndRank(insights, filter);
	}

	// Called by CLI: Perceo analyze predict
	async predictFailure(changes: ChangeAnalysis[]): Promise<Prediction[]> {
		const flows = await this.flowGraph.getAllFlows();
		const predictions: Prediction[] = [];

		for (const flow of flows) {
			const prediction = await this.mlModel.predict({
				flow,
				changes,
				historicalData: await this.getHistoricalData(flow),
				productionMetrics: flow.productionMetrics,
			});

			predictions.push(prediction);
		}

		return predictions.sort((a, b) => b.probability - a.probability);
	}

	// Subscribe to test results and production data
	private subscribeToEvents(): void {
		// Learn from test results
		this.eventBus.subscribe(EventType.TESTS_COMPLETED, async (event) => {
			await this.updateMLModel(event.data);
		});

		// Analyze production metrics
		this.eventBus.subscribe(EventType.METRICS_UPDATED, async (event) => {
			const insights = await this.analyzeProductionData(event.data);

			// Publish insights
			for (const insight of insights) {
				await this.eventBus.publish({
					id: generateId(),
					type: EventType.INSIGHT_GENERATED,
					timestamp: Date.now(),
					source: "analyzer",
					data: insight,
				});
			}
		});

		// Discover new flows from production
		this.eventBus.subscribe(EventType.CORRELATION_COMPLETE, async (event) => {
			const newFlows = await this.discoverFlows(event.data);

			for (const flow of newFlows) {
				await this.eventBus.publish({
					id: generateId(),
					type: EventType.FLOW_DISCOVERED,
					timestamp: Date.now(),
					source: "analyzer",
					data: flow,
				});
			}
		});
	}

	// Detect discrepancies between synthetic and real
	private async analyzeProductionData(data: ProductionMetrics): Promise<Insight[]> {
		const insights: Insight[] = [];
		const flows = await this.flowGraph.getAllFlows();

		for (const flow of flows) {
			if (!flow.productionMetrics) continue;

			const synthetic = flow.syntheticMetrics?.successRate || 1.0;
			const real = flow.productionMetrics.successRate;
			const gap = Math.abs(synthetic - real);

			if (gap > 0.2) {
				// 20+ point discrepancy
				insights.push({
					type: "discrepancy",
					severity: gap > 0.3 ? "high" : "medium",
					flow: flow.name,
					message: `${Math.round(gap * 100)}pt gap between synthetic (${Math.round(synthetic * 100)}%) and real (${Math.round(real * 100)}%) success rates`,
					suggestedAction: this.suggestAction(flow, gap),
					impact: await this.estimateRevenueImpact(flow, gap),
				});
			}
		}

		return insights;
	}
}
```

### Analytics Engine Exports

```typescript
// src/analytics/index.ts

export class AnalyticsEngine {
	constructor(
		private eventBus: EventBus,
		private flowGraph: FlowGraphClient,
		private config: AnalyticsConfig,
	) {}

	// Called by CLI: Perceo analytics connect
	async connectProvider(provider: "ga4" | "mixpanel" | "amplitude", credentials: any): Promise<void> {
		const connector = this.createConnector(provider, credentials);

		// Test connection
		await connector.test();

		// Save configuration
		await this.config.save({ provider, credentials });

		// Start ingestion
		await this.startIngestion(connector);
	}

	// Called by CLI: Perceo analytics sync
	async syncProductionData(): Promise<SyncResult> {
		const connector = await this.getConfiguredConnector();

		// Fetch events
		const events = await connector.fetchEvents({
			since: await this.getLastSyncTimestamp(),
			limit: 10000,
		});

		// Match events to flows
		const matches = await this.correlationEngine.matchToFlows(events);

		// Update flow graph with metrics
		for (const [flowName, metrics] of Object.entries(matches)) {
			await this.flowGraph.updateProductionMetrics(flowName, metrics);
		}

		// Publish event
		await this.eventBus.publish({
			id: generateId(),
			type: EventType.METRICS_UPDATED,
			timestamp: Date.now(),
			source: "analytics",
			data: { flows: Object.keys(matches), eventCount: events.length },
		});

		return {
			eventsProcessed: events.length,
			flowsUpdated: Object.keys(matches).length,
		};
	}

	// Called by CLI: Perceo analytics gaps
	async findUntestedFlows(): Promise<UntestedFlow[]> {
		const flows = await this.flowGraph.getAllFlows();
		const productionSessions = await this.getProductionSessions();

		// Find patterns in production that don't match any flow
		const clusters = await this.clusterSessions(productionSessions);
		const untested: UntestedFlow[] = [];

		for (const cluster of clusters) {
			const matched = flows.find((f) => this.correlationEngine.calculateSimilarity(f, cluster) > 0.7);

			if (!matched) {
				untested.push({
					pattern: cluster.pattern,
					weeklyUsers: cluster.sessionCount,
					avgDuration: cluster.avgDuration,
					confidence: cluster.confidence,
				});
			}
		}

		// Publish discoveries
		await this.eventBus.publish({
			id: generateId(),
			type: EventType.CORRELATION_COMPLETE,
			timestamp: Date.now(),
			source: "analytics",
			data: { untested },
		});

		return untested;
	}

	// Called by CLI: Perceo analytics impact
	async estimateRevenueImpact(flowName: string): Promise<RevenueImpact> {
		const flow = await this.flowGraph.getFlow(flowName);

		if (!flow.productionMetrics) {
			throw new Error("No production metrics available");
		}

		const { successRate, volume24h } = flow.productionMetrics;
		const syntheticRate = flow.syntheticMetrics?.successRate || 1.0;

		// Calculate potential improvement
		const currentDailySuccess = volume24h * successRate;
		const potentialDailySuccess = volume24h * syntheticRate;
		const gap = potentialDailySuccess - currentDailySuccess;

		// Estimate revenue (requires avg order value from analytics)
		const avgOrderValue = await this.getAvgOrderValue(flowName);
		const dailyImpact = gap * avgOrderValue;

		return {
			flow: flowName,
			currentSuccessRate: successRate,
			potentialSuccessRate: syntheticRate,
			dailyAttempts: volume24h,
			avgOrderValue,
			estimatedDailyImpact: dailyImpact,
			estimatedMonthlyImpact: dailyImpact * 30,
			estimatedAnnualImpact: dailyImpact * 365,
		};
	}
}
```

---

## Shared Data Models

### Flow Graph Schema (Neo4j)

```cypher
// Nodes
(Flow {
  id: string,
  name: string,
  description: string,
  priority: "critical" | "high" | "medium" | "low",
  createdAt: timestamp,
  lastModified: timestamp,

  // Observer data
  affectedByChanges: [changeId],
  riskScore: float,

  // Analyzer data
  insights: [Insight],
  predictions: [Prediction],
  coverageScore: float,

  // Analytics data
  productionMetrics: {
    successRate: float,
    dailyUsers: int,
    avgDuration: int,
    topExitStep: string,
    deviceBreakdown: {...},
    cohortPerformance: {...}
  },

  // Coordinator data
  syntheticMetrics: {
    successRate: float,
    avgDuration: int,
    lastRun: timestamp
  },

  testResults: [TestResult]
})

(Step {
  id: string,
  name: string,
  sequence: int,
  actions: [string],
  expectedState: {...}
})

(Persona {
  id: string,
  name: string,
  description: string,
  behaviors: [...]
})

// Relationships
(Flow)-[:HAS_STEP]->(Step)
(Flow)-[:FOR_PERSONA]->(Persona)
(Flow)-[:RELATED_TO]->(Flow)
(Step)-[:NEXT]->(Step)
```

### Shared TypeScript Interfaces

```typescript
// src/core/types.ts

export interface Flow {
	id: string;
	name: string;
	description: string;
	priority: "critical" | "high" | "medium" | "low";
	steps: Step[];
	personas: string[];

	// Observer contributions
	affectedByChanges?: string[];
	riskScore?: number;

	// Analyzer contributions
	insights?: Insight[];
	predictions?: Prediction[];
	coverageScore?: number;

	// Analytics contributions
	productionMetrics?: ProductionMetrics;

	// Coordinator contributions
	syntheticMetrics?: SyntheticMetrics;
	testResults?: TestResult[];

	createdAt: number;
	lastModified: number;
}

export interface ProductionMetrics {
	successRate: number;
	dailyUsers: number;
	avgDuration: number; // milliseconds
	topExitStep?: string;
	deviceBreakdown?: {
		mobile: number;
		desktop: number;
		tablet: number;
	};
	cohortPerformance?: {
		new_users: number;
		returning_users: number;
		[key: string]: number;
	};
	lastUpdated: number;
}

export interface SyntheticMetrics {
	successRate: number;
	avgDuration: number;
	lastRun: number;
	runCount: number;
}

export interface Insight {
	id: string;
	type: "discrepancy" | "coverage-gap" | "ux-issue" | "prediction";
	severity: "critical" | "high" | "medium" | "low";
	flow: string;
	message: string;
	suggestedAction?: string;
	impact?: RevenueImpact;
	createdAt: number;
}

export interface Prediction {
	flowName: string;
	probability: number; // 0-1
	confidence: number; // 0-1
	reasoning: string;
	basedOn: "ml-model" | "heuristic" | "pattern";
}
```

---

## Configuration Management

### Unified Config File

```jsonc
// .perceo/config.json (base)

{
	"version": "1.0",
	"project": {
		"name": "my-app",
		"framework": "nextjs",
	},

	// Observer Engine config
	"observer": {
		"watch": {
			"paths": ["app/", "src/"],
			"ignore": ["node_modules/", ".next/"],
			"debounceMs": 500,
			"autoTest": true,
		},
		"ci": {
			"strategy": "affected-flows",
			"parallelism": 5,
		},
		"analysis": {
			"useLLM": true,
			"llmThreshold": 0.7,
		},
	},

	// Analyzer Engine config
	"analyzer": {
		"insights": {
			"enabled": true,
			"updateInterval": 3600, // 1 hour
			"minSeverity": "medium",
		},
		"predictions": {
			"enabled": true,
			"model": "ml", // or "heuristic"
			"confidenceThreshold": 0.6,
		},
		"coverage": {
			"minCoverageScore": 0.7,
			"alertOnGaps": true,
		},
	},

	// Analytics Engine config
	"analytics": {
		"provider": "ga4",
		"credentials": "${ANALYTICS_CREDENTIALS}",
		"syncInterval": 300, // 5 minutes
		"correlation": {
			"algorithm": "smith-waterman",
			"minSimilarity": 0.7,
		},
		"revenueTracking": {
			"enabled": true,
			"avgOrderValueSource": "analytics", // or "manual"
		},
	},

	// Shared config
	"flowGraph": {
		"endpoint": "bolt://localhost:7687",
		"database": "Perceo",
	},

	"eventBus": {
		"type": "redis", // or "in-memory"
		"redisUrl": "redis://localhost:6379",
	},

	"notifications": {
		"slack": {
			"enabled": false,
			"webhook": "",
		},
		"email": {
			"enabled": false,
			"recipients": [],
		},
	},
}
```

### Local Development Overrides

To make it easy to test the CLI and engine integrations locally before publishing packages, the CLI supports a simple override mechanism:

- **Base config**: `.perceo/config.json` (checked into your app repo).
- **Local config**: `.perceo/config.local.json` (optional, typically **git-ignored**).

Resolution rules implemented by the CLI:

- By default, `perceo` reads `.perceo/config.json`.
- If `PERCEO_ENV=local` (or `NODE_ENV=development`) and `.perceo/config.local.json` exists, it is **deep‑merged on top of** the base config.
- You can fully override the path with `PERCEO_CONFIG_PATH=/absolute/or/relative/path/to/config.json`.

Example `.perceo/config.local.json` for local engine testing:

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
	"analytics": {
		"provider": "ga4",
		"credentials": "file:./secrets/ga4-local.json",
	},
}
```

This lets Perceo maintainers and advanced users:

- Use cloud/production settings in `config.json`.
- Quickly switch to on-device / local infrastructure for testing by:

```bash
export PERCEO_ENV=local
perceo watch --dev --analyze
```

without exposing those local‑only details in the public npm package itself.

---

## CLI Implementation Example

```typescript
// src/cli/commands/watch.ts

import { Command } from "commander";
import { ObserverEngine } from "../../observer";
import { AnalyzerEngine } from "../../analyzer";
import { EventBus } from "../../core/event-bus";
import { EventType } from "../../core/events";

export class WatchCommand {
	async execute(options: WatchOptions): Promise<void> {
		const config = await loadConfig();
		const eventBus = new EventBus(config.eventBus);

		// Initialize Observer
		const observer = new ObserverEngine(eventBus, new FlowGraphClient(config.flowGraph), config.observer);

		// Initialize Analyzer (if enabled)
		let analyzer: AnalyzerEngine | null = null;
		if (options.analyze || config.analyzer.insights.enabled) {
			analyzer = new AnalyzerEngine(eventBus, new FlowGraphClient(config.flowGraph), config.analyzer);
		}

		// Subscribe to events for terminal output
		eventBus.subscribe(EventType.FLOWS_AFFECTED, (event) => {
			console.log(`\n[${timestamp()}] Flows affected by changes:`);
			for (const flow of event.data.flows) {
				console.log(`  • ${flow.name} (risk: ${flow.riskScore.toFixed(2)})`);
			}
		});

		if (analyzer) {
			eventBus.subscribe(EventType.INSIGHT_GENERATED, (event) => {
				const { severity, message } = event.data;
				const icon = severity === "high" ? "⚠️" : "ℹ️";
				console.log(`\n${icon} [Analyzer] ${message}`);
			});
		}

		eventBus.subscribe(EventType.TESTS_COMPLETED, (event) => {
			const { passed, failed, duration } = event.data;
			const status = failed === 0 ? "✅" : "❌";
			console.log(`\n${status} Tests: ${passed} passed, ${failed} failed (${(duration / 1000).toFixed(1)}s)`);
		});

		// Start watching
		console.log("🔍 Perceo Observer started");
		if (analyzer) {
			console.log("🧠 Analyzer Engine enabled");
		}
		console.log(`📁 Watching: ${config.observer.watch.paths.join(", ")}\n`);

		await observer.startWatch();

		// Keep process alive
		await new Promise(() => {}); // Run forever
	}
}
```

```typescript
// src/cli/commands/analytics.ts

import { Command } from "commander";
import { AnalyticsEngine } from "../../analytics";

export class AnalyticsCommand {
	async executeSync(options: SyncOptions): Promise<void> {
		const config = await loadConfig();
		const eventBus = new EventBus(config.eventBus);

		const analytics = new AnalyticsEngine(eventBus, new FlowGraphClient(config.flowGraph), config.analytics);

		console.log("🔄 Syncing production data...");
		const spinner = createSpinner();
		spinner.start();

		try {
			const result = await analytics.syncProductionData();
			spinner.stop();

			console.log("✅ Sync complete");
			console.log(`   Events processed: ${result.eventsProcessed}`);
			console.log(`   Flows updated: ${result.flowsUpdated}`);

			// Show any new insights
			eventBus.subscribe(EventType.INSIGHT_GENERATED, (event) => {
				console.log(`\n💡 New insight: ${event.data.message}`);
			});
		} catch (error) {
			spinner.stop();
			console.error("❌ Sync failed:", error.message);
			process.exit(1);
		}
	}

	async executeGaps(options: GapsOptions): Promise<void> {
		const config = await loadConfig();
		const eventBus = new EventBus(config.eventBus);

		const analytics = new AnalyticsEngine(eventBus, new FlowGraphClient(config.flowGraph), config.analytics);

		console.log("🔍 Searching for untested flows in production...\n");

		const untested = await analytics.findUntestedFlows();

		if (untested.length === 0) {
			console.log("✅ All production flows are tested!");
			return;
		}

		console.log(`Found ${untested.length} untested flow(s):\n`);

		for (const flow of untested) {
			console.log(`📊 ${flow.pattern.name}`);
			console.log(`   Weekly users: ${flow.weeklyUsers}`);
			console.log(`   Avg duration: ${(flow.avgDuration / 1000).toFixed(1)}s`);
			console.log(`   Confidence: ${(flow.confidence * 100).toFixed(0)}%`);
			console.log();
		}

		console.log("💡 Run `Perceo flows create` to add these flows to your test suite");
	}
}
```

---

## Development Workflow

### Local Development (All Engines Running)

```bash
# Terminal 1: Start Observer in watch mode with Analyzer
perceo watch --dev --analyze

# Terminal 2: Start Analytics sync (background process)
perceo analytics sync --daemon

# Terminal 3: Start Dashboard
perceo dashboard --open

# Now:
# - Observer watches for file changes
# - Analyzer generates real-time insights
# - Analytics syncs production data every 5 min
# - Dashboard shows everything in real-time
```

### Managed Services & Local Testing Setup

The Observer Engine, Analyzer Engine, and Analytics Engine are implemented as **separate managed services** so that their internal code and models are **not** shipped inside the public `@perceo/perceo` npm package. The CLI interacts with these engines over APIs and the event bus.

For local, on-device development of the first versions, you can run compatible infrastructure yourself:

#### 1. Flow Graph Database (Neo4j)

- **Purpose**: Stores flows, personas, test results, production metrics, and analyzer insights.
- **Used by**: All three engines plus the Coordinator.
- **Config mapping**: `.perceo/config.json -> flowGraph.endpoint` and `flowGraph.database`.

Local Neo4j with Docker:

```bash
docker run \
  --name perceo-neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/test1234 \
  neo4j:5
```

Update `.perceo/config.json` if you change the URI, database, or credentials.

#### 2. Perceo Managed APIs on Supabase

To avoid exposing engine implementation details in the CLI package, the Observer/Analyzer/Analytics engines are designed to run behind managed APIs. For local testing, you can host equivalent APIs using Supabase:

- **Supabase roles**:
    - Postgres: long-term event store, metrics, and configuration.
    - Auth: multi-project and multi-user access control for Perceo.
    - Edge functions: HTTP/GraphQL endpoints that expose engine capabilities to the CLI.

Suggested local setup:

```bash
# In a separate folder from your app
supabase init perceo-services
cd perceo-services
supabase start
```

High-level mapping:

- Observer Engine API:
    - Stores change events and affected flows into Supabase (and mirrors key data into Neo4j).
- Analyzer Engine API:
    - Reads flow graph from Neo4j, stores insights and model state in Supabase.
- Analytics Engine API:
    - Ingests external analytics (GA4, Mixpanel, etc.), stores raw events in Supabase, and updates Neo4j metrics.

In a hosted environment, these services live in Perceo Cloud; locally, you can approximate them with Supabase-based functions and tables without bundling any of that engine code into the CLI.

#### 3. Event Bus (Redis or In-Memory)

The event bus connects engines and the coordinator:

- **Local default**: in-memory event bus (`eventBus.type = "in-memory"`).
- **Distributed/dev**: Redis (`eventBus.type = "redis"` and `eventBus.redisUrl` set).

Local Redis with Docker:

```bash
docker run -d --name perceo-redis -p 6379:6379 redis:7
```

#### 4. Putting It All Together

1. Start Neo4j and (optionally) Redis locally.
2. Run your Supabase-backed Perceo managed APIs locally (or point the CLI at Perceo Cloud).
3. Initialize your project with:

```bash
perceo init
```

This generates `.perceo/config.json` with:

- Observer, Analyzer, and Analytics engine settings.
- Flow graph connection (Neo4j).
- Event bus configuration (in-memory or Redis).

4. Start the full local loop:

```bash
perceo watch --dev --analyze &
perceo analytics sync &
perceo dashboard --open
```

This setup lets you iterate on the CLI and configuration while keeping the core engine implementations isolated in managed services (or Supabase-hosted APIs) instead of inside the npm package.

### CI/PR Workflow (Observer → Analyzer → Coordinator)

```yaml
# .github/workflows/perceo.yml

- name: Analyze PR with predictions
  run: |
      perceo ci analyze \
        --base ${{ github.base_ref }} \
        --head ${{ github.head_ref }} \
        --with-insights  # Includes Analyzer predictions

- name: Run affected tests
  run: |
      perceo ci test \
        --flows-from analyze \
        --parallel 5
```

### Production Monitoring (Analytics → Analyzer → Alerts)

```bash
# Cron job or scheduled task
0 */1 * * * perceo analytics sync
0 */6 * * * perceo analyze insights --severity high --notify
```

---

## Next Steps

1. **Implement Event Bus** (Week 1)
    - Redis pub/sub for distributed mode
    - In-memory for local development
    - Event replay for debugging

2. **Define Shared Interfaces** (Week 1)
    - TypeScript types in `src/core/types.ts`
    - Neo4j schema for Flow Graph
    - Event payloads for each engine

3. **Build CLI Foundation** (Week 1)
    - Commander.js setup
    - Config file management
    - Shared utilities

4. **Integrate Observer** (Week 2)
    - Export key methods
    - Subscribe to relevant events
    - Publish flow impact events

5. **Integrate Analyzer** (Week 3)
    - Subscribe to test results
    - Subscribe to production metrics
    - Publish insights and predictions

6. **Integrate Analytics** (Week 3)
    - Build connector framework
    - Implement correlation engine
    - Publish metrics updates

7. **End-to-End Testing** (Week 4)
    - All engines running together
    - Event flow validation
    - Performance benchmarking

---

## Summary

The unified CLI architecture ensures:

1. **Clear Separation**: Each engine is independently developed and testable
2. **Loose Coupling**: Event bus enables async communication without direct dependencies
3. **Seamless Integration**: Engines collaborate through well-defined events and shared data models
4. **Developer Experience**: Single CLI with intuitive commands that orchestrate multiple engines
5. **Scalability**: Redis-based event bus allows distributed deployment when needed

The Observer detects changes, the Analyzer provides intelligence, and the Analytics engine validates against reality — all working together through a unified interface that developers interact with via `perceo` commands.
