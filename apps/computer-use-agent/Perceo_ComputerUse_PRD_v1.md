# Perceo — Computer Use Testing Platform

## Product Requirements Document v1.1


| Field         | Value                                |
| ------------- | ------------------------------------ |
| Version       | v1.1 — Computer Use Sprint           |
| Date          | March 2026                           |
| Status        | Specification (desktop stack TBD in repo) |
| Authors       | Pranav Kannepalli · Achintya Agrawal |
| Sprint Target | Windows VM functional — 2 weeks      |
| Full Target   | Windows + Linux + macOS — 6 weeks    |


> **Mission:** Transform regression testing from a coding burden into an intelligent observation and simulation system. The agent watches a desktop like a human, acts like a human, and reports back with precision.

### Alignment with the Perceo monorepo (this repository)

This PRD describes the **computer-use execution plane** (VM adapters, vision agent loop, run orchestration, live telemetry). That stack is **not implemented in-tree yet**: there is no `packages/agent`, `packages/vm-adapters`, or a dedicated coordinator package. The folder `apps/computer-use-agent/` currently holds this document only.

**Already built and relevant here:**

- **Flows, personas, and steps** are stored in **Supabase (Postgres)**, not as JSON files under `.perceo/flows/`. The CLI’s `.perceo/config.json` is behavior/config only (paths, strategies, project linkage)—flow definitions are loaded from the database after bootstrap.
- **`apps/temporal-worker`** runs Temporal workflows (e.g. `bootstrapProjectWorkflow`) that call activities persisting **personas** and **flows** via `@perceo/supabase` (see `persistFlowsActivity` and related code).
- **`packages/observer-engine`** powers CLI init/watch/analyze: bootstrap can go through Temporal or the managed Observer API; change analysis uses Git + API.
- **`test_runs`** already includes `agent_type` (allowed values include `'playwright'`, `'computer-use'`, `'hybrid'`) so synthetic runs can be attributed to this agent when execution lands.

**Implication for this document:** The `FlowManifest` interface below is the **runtime contract** the coordinator materializes from the database. Prefer **typed columns** in a **1:1 `flow_computer_use` table** over stuffing payloads into `flows.graph_data`—structured fields are easier to validate, index, migrate, and expose in admin UI. See [Recommended table: flow_computer_use](#recommended-table-flow_computer_use).

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Core Principles](#core-principles)
4. [System Architecture](#system-architecture)
5. [Flow Manifest Schema](#flow-manifest-schema)
6. [Phase 1 — Windows VM Sprint (Days 1–14)](#phase-1--windows-vm-sprint-days-114)
7. [Phase 2 — Linux VM (Days 15–21)](#phase-2--linux-vm-days-1521)
8. [Phase 3 — macOS (Days 22–35)](#phase-3--macos-days-2235)
9. [Phase 4 — Robustness and Intelligence (Days 36–56)](#phase-4--robustness-and-intelligence-days-3656)
10. [Phase 5 — Observer Engine and Supabase integration (Days 57–70)](#phase-5--observer-engine-and-supabase-integration-days-5770)
11. [Technical Requirements](#technical-requirements)
12. [Success Metrics](#success-metrics)
13. [Open Questions](#open-questions)
14. [Appendix: Example Flow Manifest](#appendix-example-flow-manifest)

---

## Executive Summary

Perceo's computer use system enables fully automated regression testing of any application that runs on a desktop OS — websites, native desktop apps, CLI tools, audio/voice apps, mobile emulators — without writing a single line of test code. Agents observe a live VM desktop via screenshot, reason about what they see using a vision-language model, and inject mouse, keyboard, and audio input to validate user flows.

This PRD covers the full architecture and a two-week sprint plan to ship the Windows VM implementation, followed by Linux and macOS. The system is designed so the agent, coordinator, and dashboard code is written exactly once — the only thing that changes between OS targets is the thin transport adapter that connects input injection to the VM.


| Metric               | Value                                          |
| -------------------- | ---------------------------------------------- |
| Sprint 1 target      | Windows VM                                     |
| Sprint 2 target      | Linux VM                                       |
| Sprint 3 target      | macOS (bare metal)                             |
| Agent code reuse     | 100%                                           |
| Scheduling priority  | **Wall-clock latency over VM cost** (always)   |


---

## Problem Statement

Existing testing tools fall into two traps. Scripted tools (Playwright, Selenium, Appium) require engineers to write and maintain brittle test code that breaks when the UI changes. Visual testing tools only check screenshots and cannot simulate real user behavior. Neither approach tests the full breadth of what modern teams build: a startup building an AI voice assistant, a desktop transcription tool, or an Android app running in emulation cannot use either class of tool effectively.

Perceo's computer use approach dissolves both problems. Because the agent perceives the application the same way a human does — via a screenshot — it is inherently robust to UI changes. Because it sends real input events through the OS input stack, it tests what actually matters: whether a user can complete their goal.

### App categories covered

- Web apps (browser-based, any framework)
- Electron and native desktop apps (e.g. Whisper desktop, VS Code extensions)
- **GitHub repos** — any app that can be cloned, built, and run from source (Next.js apps, Python servers, Electron apps in dev mode, CLI tools, etc.)
- CLI tools and background daemons (test via terminal + filesystem assertions)
- Audio and voice applications (inject audio, capture and transcribe output)
- Android apps via emulator running inside the Windows or Linux VM
- iOS apps via Simulator on macOS (Phase 3)
- Any combination of the above in a single flow

---

## Core Principles

### 1. The agent is a human at a keyboard

The agent never parses DOM, accessibility trees, or selectors. It sees a JPEG screenshot, reasons about what is on screen, and emits normalized input coordinates. This is the only design that works uniformly across web, native, mobile emulation, and voice — they all produce a desktop image and all accept mouse/keyboard/audio events.

### 2. OS is an infrastructure concern, not an agent concern

The agent outputs normalized (0.0–1.0) coordinates and abstract actions (`click`, `type`, `inject_audio`, `capture_audio`). A thin VM adapter translates these to RDP input on Windows, VNC input on Linux, and VNC input on macOS. The agent never imports OS-specific code.

### 3. Two-layer snapshot model for near-instant startup

Apps come in two forms and each needs a different snapshot strategy.

**Pre-built apps** (Whisper desktop, an Electron binary, a mobile emulator with an APK) are installed once into a VM snapshot. Every test run restores that snapshot — the app is already installed and in a known state. Cold-start time: under 15 seconds.

**GitHub repos** cannot be snapshotted at the code level because the whole point is to test the latest commit. Instead, the base snapshot contains only the runtime environment (Node, Python, system deps, build tools, any required services). On every test cycle the coordinator clones or pulls the repo, runs the build, and starts the app before handing off to the agent. The snapshot buys you fast environment setup; the fresh checkout buys you current code.

The `appSource` field in the flow manifest declares which model applies. If `appSource.type` is `repo`, the coordinator runs the refresh cycle before the agent starts. If it is `installed`, it restores the snapshot and goes straight to the agent.

### 4. Coordinator owns strategy, agents own execution

The Temporal coordinator decides which flows to run, in which order, on which VM type, and what to do on failure. Individual agents execute one step at a time and report status. The coordinator can abort, retry, or re-plan mid-run without touching agent code.

### 5. Zero test code, always

Engineers define flows in natural language or confirm flows produced by bootstrap (Temporal + LLM) and **stored in Supabase**—not by maintaining Playwright scripts or selectors in-repo. Computer-use runs interpret **goals and success criteria** (from DB fields or derived text), not DOM locators. Scripted runner steps in `steps.actions` today skew toward structured actions (e.g. click/fill); computer-use can treat those as hints or ignore them in favor of vision—product decision when wiring the worker.

### 6. Wall-clock beats VM spend (scheduling)

**In all scenarios, optimize for elapsed time, not for minimizing concurrent VMs or total VM-hours.** Extra machines, parallel restores from the same **checkpoint snapshot**, and duplicated short setup are acceptable if they shorten time-to-green for the developer.

Implications:

- **Branching flows** (many tests from one shared app state): run a **preamble once** per batch to reach that state—ideally materialized as a **checkpoint snapshot**—then **fan out**: **one branch per VM in parallel**, each restoring from that checkpoint (or equivalent), rather than one VM running branches **serially** to save cost.
- **Temporal / coordinator** defaults should favor **parallel activities** and a **concurrency floor** driven by latency targets; queuing is for **capacity limits**, not for penny-pinching.
- **Success metrics** and internal SLOs emphasize **p50/p95 wall-clock** for a suite or PR gate, not VM utilization.

---

## System Architecture

### Component map


| Layer         | Component               | Responsibility                                                                  |
| ------------- | ----------------------- | ------------------------------------------------------------------------------- |
| Trigger       | GitHub / CLI / API      | PR flow today: CI runs `perceo ci analyze`; managed API + Temporal for bootstrap; future: webhook/POST to start desktop runs |
| Orchestration | Temporal coordinator    | Plans flows, selects VM type, **dispatches agents in parallel** where independent; wall-clock over VM cost (see [§6](#6-wall-clock-beats-vm-spend-scheduling)) |
| Compute       | VM pool                 | Sized for **parallelism**; pre-warmed Windows, Linux, macOS VMs with app snapshots installed |
| Execution     | Universal desktop agent | Screenshot → LLM reasoning → normalized action → VM adapter → OS input          |
| Observability | Telemetry bus           | Supabase Realtime; agents push step results + screenshots; dashboard subscribes |
| UI            | Dashboard               | Live desktop view, timeline, coordinator log, pass/fail, replay                 |


### VM adapter interface

The only thing that differs between OS targets is the VM adapter — a small class implementing four methods. The agent calls these; it has no other OS surface.

```typescript
interface VMAdapter {
	getScreenshot(): Promise<Buffer>; // returns JPEG bytes of full desktop
	click(nx: number, ny: number): Promise<void>; // normalized 0.0–1.0 coords
	type(text: string): Promise<void>;
	scroll(nx: number, ny: number, direction: "up" | "down", clicks: number): Promise<void>;
	injectAudio(filepath: string): Promise<void>;
	captureAudio(durationMs: number): Promise<Buffer>; // returns PCM bytes
	getResolution(): Promise<{ width: number; height: number }>;
}
```


| Method              | Windows                        | Linux                             | macOS                               |
| ------------------- | ------------------------------ | --------------------------------- | ----------------------------------- |
| `getScreenshot()`   | RDP frame via pyrdp / freerdp  | VNC frame via python-vnc or scrot | VNC via python-vnc or screencapture |
| `click(nx, ny)`     | RDP SendInput mouse event      | xdotool mousemove + click         | cliclick or osascript               |
| `type(text)`        | RDP SendInput scan codes       | xdotool type                      | cliclick type or osascript          |
| `injectAudio(file)` | Virtual Audio Cable (VB-Audio) | PulseAudio null sink              | BlackHole virtual device            |
| `captureAudio(ms)`  | VAC virtual output capture     | parec from null sink monitor      | Record from BlackHole output        |


### Coordinate normalization

All agent actions use normalized coordinates in the range [0.0, 1.0]. The VM adapter multiplies by the VM's actual resolution before injecting. A flow recorded at 1920×1080 replays correctly on a 2560×1600 display with no changes.

> **Critical rule:** Agent code never contains pixel coordinates, screen resolutions, or OS-specific imports. Any such code is a bug.

### Screenshot streaming and live view

Each agent pushes a compressed desktop screenshot to Supabase Storage at key `vm-{id}/latest.jpg` every time a step completes, and every 2 seconds during long-running steps. A metadata row update fires a Supabase Realtime event and the dashboard swaps the `<img>` src. Frame diff suppression on the agent side skips pushes when pixel delta is below 1% — eliminates bandwidth waste during loading screens and idle waits.

### Agent reasoning loop

```
loop:
  screenshot = adapter.getScreenshot()
  action = llm.call(system_prompt, screenshot, current_step, working_memory)
  // action is one of: { type: "click", x, y }
  //                   { type: "type", text }
  //                   { type: "scroll", x, y, direction }
  //                   { type: "inject_audio", file }
  //                   { type: "done", success: bool, reason: string }
  adapter.execute(action)
  telemetry.push({ step, action, screenshot_url, timestamp, success })
  working_memory.append(one_sentence_summary)
  if action.type == "done": break
```

The LLM system prompt describes the agent's goal, success criteria, app context, and the action schema. **Target location once built:** e.g. `apps/computer-use-agent/prompts/agent-system.md` or `packages/agent/src/prompts/agent-system.md`—today no such file exists in the monorepo.

---

## Flow Manifest Schema

### Canonical storage: Supabase (today)

In this monorepo, **flows are rows in `flows`**, scoped to `project_id`, optionally linked to **`personas`**, with route/bootstrap context in **`graph_data` jsonb** (e.g. `triggerConditions`, `pages`, `connectedFlowIds` per migrations). **Desktop execution settings** should live in **`flow_computer_use`** (1:1, migration pending)—not in `graph_data`. Ordered **executable steps** live in **`steps`** (`actions` jsonb, `expected_state`, etc.). **Run results** go to **`test_runs`** (status, screenshots, `agent_id`, **`agent_type`** including `'computer-use'`).

The PRD’s manifest is the **logical shape the coordinator-worker needs at runtime**. Implementations should **load or derive** it from these tables (plus secrets from env/Temporal), not assume `.perceo/flows/*.json` unless we add an explicit export/import feature.

### Optional on-disk manifests

A JSON file at `.perceo/flows/<flow-id>.json` can remain a **developer-local or CI export format** for debugging or for repos that opt out of cloud flow storage—it is **not** the source of truth in the current product.

### Runtime `FlowManifest` interface

The coordinator uses this shape to select the VM type, locate the app snapshot, construct the agent's task, and — if the app is a GitHub repo — run the build and start cycle before handing off to the agent.

```typescript
interface FlowManifest {
	flowId: string; // maps to flows.id (uuid) in Supabase
	name: string; // human-readable, shown in dashboard and PR comments
	vmType: "windows" | "linux" | "macos";
	appSnapshot: string; // name of the base VM snapshot to restore (runtime env)
	appSource: AppSource; // what to run — installed binary or GitHub repo
	goal: string; // natural language: what should the agent accomplish
	successCriteria: string; // natural language: what does success look like on screen
	timeout: number; // seconds before coordinator marks flow timed out
	priority: "high" | "medium" | "low";
}

type AppSource =
	| {
			type: "installed";
			// App is pre-installed in the snapshot. Coordinator restores snapshot and
			// hands off to agent immediately. No build step.
			appSetupScript: string; // path to script run ONCE to create the snapshot
	  }
	| {
			type: "repo";
			// App is a GitHub repo. Coordinator clones/pulls, builds, and starts the app
			// on EVERY test cycle. The snapshot contains only the runtime environment.
			repoUrl: string; // e.g. "https://github.com/org/repo"
			branch?: string; // defaults to the PR branch being tested
			buildScript: string; // e.g. "npm install && npm run build"
			startScript: string; // e.g. "npm run dev" or "python app.py"
			startedWhen: string; // how to know the app is ready: "port:3000" | "stdout:Ready" | "file:/tmp/ready"
			envSecrets?: string[]; // names of Temporal secrets to inject as env vars
			runtimeSnapshot: string; // base snapshot name — has Node/Python/deps pre-installed
	  };
```

**Mapping from Supabase (when implementing):**

| Manifest field | Storage |
| -------------- | ------- |
| `flowId` | `flows.id` |
| `name` | `flows.name` |
| `priority` | `flows.priority` |
| `goal` | `flow_computer_use.goal` |
| `successCriteria` | `flow_computer_use.success_criteria` |
| `timeout` | `flow_computer_use.timeout_seconds` |
| `vmType` | `flow_computer_use.vm_type` |
| `appSnapshot` (top-level manifest) | `flow_computer_use.vm_snapshot_name` — VM image to restore (`installed`: app snapshot; `repo`: toolchain/runtime snapshot before clone/build) |
| `appSource.type` | `flow_computer_use.app_source_type` |
| `appSource.appSetupScript` | `flow_computer_use.app_setup_script_path` (`installed` only; nullable if snapshot was produced out-of-band) |
| `appSource.repoUrl` / `branch` / `buildScript` / `startScript` / `startedWhen` | `flow_computer_use.repo_url`, `repo_branch`, `build_command`, `start_command`, `ready_wait_spec` (`repo` only) |
| `appSource.envSecrets` | `flow_computer_use.env_secret_names` (`text[]`) |
| `appSource.runtimeSnapshot` | `flow_computer_use.runtime_snapshot_name` (`repo` only; often matches `vm_snapshot_name`) |
| `appSource.cacheStrategy` | `flow_computer_use.cache_strategy` |
| Persona context | `flows.persona_id` → `personas` |

Flows without a `flow_computer_use` row are not eligible for desktop execution (other agents / observer-only).

### Recommended table: flow_computer_use

Add a **1:1** table keyed by `flow_id` so desktop-specific fields stay normalized and `CHECK` constraints can enforce **installed** vs **repo** invariants. `flows.graph_data` remains for route/bootstrap/observer metadata only.

```sql
CREATE TABLE flow_computer_use (
  flow_id uuid PRIMARY KEY REFERENCES flows(id) ON DELETE CASCADE,

  goal text NOT NULL,
  success_criteria text NOT NULL,
  timeout_seconds int NOT NULL DEFAULT 300 CHECK (timeout_seconds > 0),

  vm_type text NOT NULL CHECK (vm_type IN ('windows', 'linux', 'macos')),
  vm_snapshot_name text NOT NULL,

  app_source_type text NOT NULL CHECK (app_source_type IN ('installed', 'repo')),

  app_setup_script_path text,

  repo_url text,
  repo_branch text,
  build_command text,
  start_command text,
  ready_wait_spec text NOT NULL,
  env_secret_names text[] NOT NULL DEFAULT '{}',
  runtime_snapshot_name text,
  cache_strategy text NOT NULL DEFAULT 'none'
    CHECK (cache_strategy IN ('none', 'deps-only', 'full')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT flow_computer_use_installed_shape CHECK (
    app_source_type <> 'installed'
    OR (
      repo_url IS NULL
      AND repo_branch IS NULL
      AND build_command IS NULL
      AND start_command IS NULL
      AND runtime_snapshot_name IS NULL
    )
  ),
  CONSTRAINT flow_computer_use_repo_shape CHECK (
    app_source_type <> 'repo'
    OR (
      repo_url IS NOT NULL
      AND build_command IS NOT NULL
      AND start_command IS NOT NULL
      AND runtime_snapshot_name IS NOT NULL
    )
  )
);

CREATE INDEX idx_flow_computer_use_vm_type ON flow_computer_use (vm_type);

COMMENT ON TABLE flow_computer_use IS '1:1 desktop (computer-use) execution config; join to flows for shared metadata.';
COMMENT ON COLUMN flow_computer_use.ready_wait_spec IS 'Coordinator readiness probe, e.g. port:3000 | stdout:Ready | file:/tmp/ready | delay:5';
COMMENT ON COLUMN flow_computer_use.env_secret_names IS 'Names only; values resolved from Temporal secrets or env at run time, never stored here.';
```

**RLS:** mirror `flows`—e.g. `SELECT`/`INSERT`/`UPDATE`/`DELETE` allowed when `is_project_member` for `flows.project_id` (require migration policies).

### Repo source — coordinator lifecycle

When `appSource.type` is `repo`, the coordinator runs a **refresh cycle** before every agent dispatch. This is a Temporal activity, so it retries automatically on failure and its output (the started app's process handle) is passed to the agent activity.

```typescript
async function repoRefreshActivity(source: RepoAppSource, vmHandle: VMHandle) {
	// 1. Restore the runtime base snapshot (has Node/Python/deps, no app code)
	await vm.restoreSnapshot(source.runtimeSnapshot);

	// 2. Clone or pull latest
	const branch = source.branch ?? currentPRBranch();
	await vm.exec(`
    if [ -d repo ]; then
      cd repo && git fetch && git checkout ${branch} && git pull
    else
      git clone --branch ${branch} ${source.repoUrl} repo
    fi
  `);

	// 3. Inject secrets as environment variables
	for (const secretName of source.envSecrets ?? []) {
		const value = await temporal.secrets.get(secretName);
		await vm.setEnv(secretName, value);
	}

	// 4. Build
	await vm.exec(`cd repo && ${source.buildScript}`);

	// 5. Start app in background
	await vm.execBackground(`cd repo && ${source.startScript}`);

	// 6. Wait until app signals ready
	await waitUntilReady(vmHandle, source.startedWhen);

	// 7. Hand off to agent — app is running, VM is live
}
```

`**startedWhen` strategies:**


| Value                   | Meaning                                                     |
| ----------------------- | ----------------------------------------------------------- |
| `port:3000`             | Poll until TCP port 3000 accepts connections                |
| `stdout:Server running` | Wait for this string to appear in the start script's stdout |
| `file:/tmp/app-ready`   | Wait for this file to be created by the start script        |
| `delay:5`               | Fixed delay of 5 seconds (last resort — avoid if possible)  |


### Caching the build between runs

For repos with slow builds (large `node_modules`, compiled binaries), the coordinator can optionally cache the build artifacts inside the VM between runs rather than always starting from a clean snapshot. This is controlled by a `cacheStrategy` field:

```typescript
cacheStrategy?: 'none'        // default — always restore clean snapshot before build
              | 'deps-only'   // restore snapshot but preserve node_modules / venv
              | 'full'        // skip snapshot restore entirely; just git pull + rebuild
```

`full` is fastest but risks state contamination between runs. Use `none` for correctness in CI; use `deps-only` or `full` for `perceo watch --dev` local speed.

---

## Phase 1 — Windows VM Sprint (Days 1–14)

**Timeline:** Days 1–14
**Goal:** A coordinator dispatches a universal agent into a Windows VM; the agent completes a real user flow against a real app; results appear in the dashboard and in a GitHub PR comment.

> **Constraint:** No Linux or macOS work in this phase. Ship Windows first, completely. The adapters for the other VMs are written after this is working so we can copy the exact same patterns.

---

### Week 1 — Foundation (Days 1–7)

#### Day 1–2: Windows VM provisioning

Stand up a single Windows Server 2022 VM (AWS EC2 `t3.medium` or `g4dn.xlarge` for GPU-heavy apps, or local Hyper-V). Requirements:

- RDP enabled and accessible from the agent host
- Virtual Audio Cable installed (VB-Audio free tier)
- **Two base snapshots taken:**
  - `base-clean` — OS only, RDP + VAC configured, nothing else
  - `base-runtime` — adds Node.js LTS, Python 3.11, Git, PowerShell 7, common build tools (npm, pip, MSBuild). This is the snapshot used for all repo-type flows.
- Test app installed into a third snapshot for installed-type flow validation

> **Why two base snapshots:** `base-clean` is the restore point for pre-built app flows. `base-runtime` is the restore point for repo flows — it has the build toolchain pre-installed so `npm install` doesn't start from zero every time.

**Tasks:**


| Task                             | Details                                                                       | Owner  |
| -------------------------------- | ----------------------------------------------------------------------------- | ------ |
| Provision Windows VM             | EC2 or Hyper-V, RDP open, VAC installed                                       | Pranav |
| Create `base-clean` snapshot     | OS + RDP + VAC only — restore point for installed-app flows                   | Pranav |
| Create `base-runtime` snapshot   | Adds Node LTS, Python 3.11, Git, build tools on top of `base-clean`           | Pranav |
| Write `install_base_runtime.ps1` | Idempotent script that builds the runtime snapshot from scratch               | Pranav |
| Validate RDP connectivity        | Confirm pyrdp / freerdp can connect and capture a frame from agent host       | Pranav |
| Test VAC loopback                | Verify audio can be injected to virtual mic and captured from virtual speaker | Pranav |


#### Day 3–4: Windows VM adapter

Write the `WindowsVMAdapter` class. This is the only Windows-specific code in the entire system. Target: under 200 lines.

- `getScreenshot()` — connect via RDP, capture framebuffer, return JPEG bytes
- `click(nx, ny)` — multiply normalized coords by VM resolution, send RDP mouse event
- `type(text)` — send RDP keyboard scan codes for each character
- `scroll(nx, ny, direction)` — RDP scroll wheel event
- `injectAudio(filepath)` — write WAV to VAC virtual input device
- `captureAudio(durationMs)` — record from VAC virtual output device, return PCM bytes
- `getResolution()` — return `{ width, height }` of current VM desktop

> **Note:** `pyrdp` is the recommended library for programmatic RDP input injection from Python. `freerdp` with `--plugin rdpei` is the alternative. Benchmark both on Day 3 — pick whichever gives <100ms round-trip latency for a click-to-frame cycle.

**Target file location (not present yet):** `packages/vm-adapters/src/windows.ts` or under `apps/computer-use-agent/`

#### Day 5–6: Universal agent core

The agent is a Temporal activity worker. It receives a task (goal + success criteria) and a `VMAdapter` instance.

**Target file locations (not present yet):**

- `packages/agent/src/agent.ts` — main agent loop (or colocate under `apps/computer-use-agent/`)
- `packages/agent/src/prompts/agent-system.md` — LLM system prompt (versioned separately)
- `packages/agent/src/telemetry.ts` — Supabase push helpers (reuse patterns from `@perceo/supabase` where possible)

**Agent loop pseudocode:**

```typescript
async function runAgentActivity(task: AgentTask, adapter: VMAdapter) {
	const workingMemory: string[] = [];

	while (true) {
		const screenshot = await adapter.getScreenshot();
		const screenshotUrl = await uploadScreenshot(screenshot, task.runId, task.stepIndex);

		const action = await llm.call({
			systemPrompt: loadPrompt("agent-system.md"),
			screenshot,
			goal: task.goal,
			successCriteria: task.successCriteria,
			workingMemory: workingMemory.slice(-10),
			stepIndex: task.stepIndex,
		});

		await adapter.execute(action);

		await telemetry.push({
			runId: task.runId,
			flowId: task.flowId,
			stepIndex: task.stepIndex,
			action,
			screenshotUrl,
			timestamp: Date.now(),
		});

		workingMemory.push(action.summary);
		task.stepIndex++;

		if (action.type === "done") {
			return { success: action.success, reason: action.reason };
		}

		if (task.stepIndex > task.maxSteps) {
			return { success: false, reason: "max steps exceeded" };
		}
	}
}
```

> **Key decision:** The agent does not know the app type. It only knows "you are looking at a desktop screenshot, here is your goal, here is what success looks like." This is what makes it universal.

#### Day 7: First end-to-end run

Goal: the agent opens a browser on the Windows VM, navigates to a URL, fills a form, and submits it. Coordinator dispatches the agent. Result appears in Supabase.

No dashboard yet — verify via Supabase table viewer.

- **Pass:** Flow completes, screenshot sequence saved, step results in DB
- **Acceptable failure:** Agent gets confused once but recovers without human intervention
- **Unacceptable:** Agent crashes, coordinator loses track, data not written to Supabase

> **Checkpoint:** If Day 7 end-to-end passes, Week 1 is done. If not, Day 7 becomes a debugging day and Week 2 absorbs the remaining work. Do not add features until this passes.

---

### Week 2 — Integration and Ship (Days 8–14)

#### Day 8–9: Coordinator and Temporal wiring

The desktop-run **coordinator** is a Temporal workflow (new)—distinct from **`bootstrapProjectWorkflow`** in `apps/temporal-worker`, which already persists flows/personas to Supabase. The new workflow would receive materialized `FlowManifest`s, select VMs, dispatch agent activities, and aggregate results. For repo-type flows it runs a refresh cycle before handing off to the agent.

**Target file location:** e.g. `apps/temporal-worker/src/workflows/computer-use-run.workflow.ts` and related activities, or `packages/coordinator/` if split later.

**Coordinator workflow methods:**

```typescript
async function coordinatorWorkflow(input: CoordinatorInput) {
	// Today: flows live in Supabase; replace with fetch + materialize FlowManifest[]
	const manifests = await materializeManifestsFromSupabase(input.projectId, input.affectedFlowIds);
	const prioritized = prioritizeFlows(manifests);

	const results = await Promise.all(
		prioritized.map(async (manifest) => {
			const vmHandle = await executeWithActivities.provisionVM(manifest.vmType, manifest.appSource.type === "repo" ? manifest.appSource.runtimeSnapshot : manifest.appSnapshot);

			// Repo flows: pull latest, build, start app before agent runs
			if (manifest.appSource.type === "repo") {
				await executeWithActivities.repoRefreshActivity(manifest.appSource, vmHandle);
			}

			return executeWithActivities.dispatchAgent(vmHandle, manifest);
		}),
	);

	await aggregateAndReport(results, input.prNumber);
	await teardownAll(results.map((r) => r.vmHandle));
	return results;
}
```

**Key Temporal activities:**

- `provisionVM(vmType, snapshotName)` — restore named snapshot, return VM handle
- `repoRefreshActivity(source, vmHandle)` — clone/pull, build, start, wait for ready signal (repo flows only)
- `dispatchAgent(vmHandle, manifest)` — start the agent activity
- `teardownAll(vmHandles)` — restore all VMs to their base snapshot for the next run

#### Day 10–11: GitHub integration and PR comments

**GitHub Actions workflow** (`.github/workflows/perceo.yml`):

```yaml
name: Perceo flow tests
on: [pull_request]

jobs:
    test:
        runs-on: ubuntu-latest
        steps:
            - name: Trigger Perceo run
              run: |
                  curl -X POST ${{ secrets.PERCEO_API_URL }}/api/runs \
                    -H "Authorization: Bearer ${{ secrets.PERCEO_API_KEY }}" \
                    -d '{
                      "prNumber": "${{ github.event.number }}",
                      "repo": "${{ github.repository }}",
                      "sha": "${{ github.sha }}",
                      "diffUrl": "${{ github.event.pull_request.diff_url }}"
                    }'
```

**PR comment format:**

```
## Perceo — Flow Test Results

| Flow | VM | Status | Duration | Replay |
|---|---|---|---|---|
| Checkout — purchase product | windows | ✅ passed | 1m 42s | [view](#) |
| Auth — login flow | windows | ✅ passed | 0m 58s | [view](#) |
| Onboarding — first run | windows | ❌ failed at step 3 | 1m 12s | [view](#) |

**Failure summary:** `onboarding-first-run` — agent could not locate the "Get Started" button after the welcome screen. Last screenshot attached. [View full replay](#)
```

#### Day 12–13: Live dashboard view

The dashboard subscribes to Supabase Realtime on per-step or per-run updates. **Today `test_runs` exists; a dedicated `telemetry_events` table is optional** (see [Supabase schema](#supabase-schema))—alternatively stream via `test_runs` row updates and `logs` / `screenshots` jsonb.

**Proposed table (if we want one row per agent step for Realtime): `telemetry_events`**

```sql
create table telemetry_events (
  id          uuid primary key default gen_random_uuid(),
  run_id      text not null,
  flow_id     text not null,
  vm_id       text not null,
  step_index  integer not null,
  action_type text not null,
  success     boolean,
  screenshot_url text,
  coordinator_event text,
  created_at  timestamptz default now()
);

-- Enable realtime
alter publication supabase_realtime add table telemetry_events;
```

**Dashboard components:**

- **VM viewport** — full desktop screenshot, `<img>` src swapped on each Realtime event
- **Timeline** — horizontal bar per VM, segments colored by step status (done / running / failed / waiting)
- **Coordinator log** — append-only log of coordinator events, auto-scrolling
- **Run summary** — VM count, pass/fail counts, elapsed time

The viewport shows the full Windows desktop — no cropping or device frame. Engineers need to see what the agent sees, including taskbar, system tray, and any system dialogs.

**Video replay generation** — after a run completes, stitch screenshot JPEGs with ffmpeg:

```bash
ffmpeg -framerate 4 -pattern_type glob -i 'frames/*.jpg' \
  -c:v libx264 -pix_fmt yuv420p replay.mp4
```

Upload the MP4 to Supabase Storage and link in the PR comment.

#### Day 14: Native app test — target milestone

Complete test of a non-browser native Windows app. Target: Whisper desktop. Fallback: any native Win32 or Electron app with meaningful state.

**Flow:**

1. Launch app
2. Perform a meaningful action (open file, run transcription, save output)
3. Assert on visible result (output text appears, file exists)
4. Result posted to a test GitHub PR as a comment
5. Replay link in the PR comment plays back the screenshot sequence as video

> **Phase 1 complete** when a native Windows app flow appears as a passing check on a GitHub PR. This is the demo-able moment for investors and design partners.

---

## Phase 2 — Linux VM (Days 15–21)

**Timeline:** Days 15–21 (Week 3)
**Goal:** Linux VM running the same universal agent with a new adapter. No agent code changes. VNC transport, PulseAudio loopback, Android emulator support.

The Linux adapter implements the exact same `VMAdapter` interface. The agent, coordinator, and dashboard are untouched. This phase should take 3–5 days if Phase 1 is clean.

### Linux adapter implementation

**Target file location (not present yet):** `packages/vm-adapters/src/linux.ts` or under `apps/computer-use-agent/`

```typescript
class LinuxVMAdapter implements VMAdapter {
	async getScreenshot(): Promise<Buffer> {
		// VNC frame capture via python-vnc, or:
		// exec: scrot --silent --file /tmp/frame.jpg && read file
		return execVNC("capture_frame");
	}

	async click(nx: number, ny: number): Promise<void> {
		const { width, height } = await this.getResolution();
		const px = Math.round(nx * width);
		const py = Math.round(ny * height);
		await exec(`xdotool mousemove ${px} ${py} click 1`);
	}

	async type(text: string): Promise<void> {
		await exec(`xdotool type --clearmodifiers '${text}'`);
	}

	async injectAudio(filepath: string): Promise<void> {
		// PulseAudio null sink configured as app default device
		await exec(`paplay --device=perceo-virtual-sink ${filepath}`);
	}

	async captureAudio(durationMs: number): Promise<Buffer> {
		const seconds = durationMs / 1000;
		await exec(`parec --device=perceo-virtual-sink.monitor --raw \
      --rate=16000 --channels=1 --format=s16le \
      --duration=${seconds} /tmp/capture.raw`);
		return fs.readFile("/tmp/capture.raw");
	}
}
```

**PulseAudio null sink setup** (run in app setup script):

```bash
pactl load-module module-null-sink sink_name=perceo-virtual-sink
pactl set-default-sink perceo-virtual-sink
pactl set-default-source perceo-virtual-sink.monitor
```

### Android emulator on Linux

Android emulators run natively on Linux with KVM acceleration. The agent treats the emulator window as just another desktop element.

```bash
# App setup script — install_android_app.sh
sdkmanager "emulator" "system-images;android-33;google_apis;x86_64"
avdmanager create avd -n perceo-test -k "system-images;android-33;google_apis;x86_64"
emulator -avd perceo-test -no-audio -no-window -gpu swiftshader_indirect &
adb wait-for-device
adb install app-release.apk
```

> **Important:** Do not add ADB or Appium to the agent. If the agent needs to know something about the emulator (how to dismiss a system dialog), that goes in the system prompt, not in code.

---

## Phase 3 — macOS (Days 22–35)

**Timeline:** Days 22–35 (Weeks 4–5)
**Goal:** macOS adapter on a Mac mini or GitHub hosted macOS runner. iOS Simulator support. Same agent, same coordinator.

macOS cannot run in a cloud VM due to Apple's licensing. Options in order of preference:


| Option                       | Cost           | Notes                                            |
| ---------------------------- | -------------- | ------------------------------------------------ |
| Mac mini M4 (on-prem)        | ~$600 one-time | Fastest, most flexible, best for production      |
| MacStadium cloud Mac         | ~$100/month    | Managed, good for CI                             |
| GitHub Actions macOS runners | ~$0.08/min     | Zero infra overhead, good for initial validation |


### macOS adapter

**Target file location (not present yet):** `packages/vm-adapters/src/macos.ts` or under `apps/computer-use-agent/`

```bash
# BlackHole installation (app setup script)
brew install blackhole-2ch
# Set BlackHole as default audio device via osascript or System Preferences
```

```typescript
class MacOSVMAdapter implements VMAdapter {
	async getScreenshot(): Promise<Buffer> {
		await exec("screencapture -x -t jpg /tmp/frame.jpg");
		return fs.readFile("/tmp/frame.jpg");
	}

	async click(nx: number, ny: number): Promise<void> {
		const { width, height } = await this.getResolution();
		const px = Math.round(nx * width);
		const py = Math.round(ny * height);
		await exec(`cliclick c:${px},${py}`);
	}

	async type(text: string): Promise<void> {
		await exec(`cliclick t:'${text}'`);
	}

	async injectAudio(filepath: string): Promise<void> {
		await exec(`afplay ${filepath}`); // plays through BlackHole if set as default
	}

	async captureAudio(durationMs: number): Promise<Buffer> {
		const seconds = durationMs / 1000;
		await exec(`rec -r 16000 -c 1 /tmp/capture.wav trim 0 ${seconds}`);
		return fs.readFile("/tmp/capture.wav");
	}
}
```

### iOS Simulator

The iOS Simulator runs as a standard macOS window. Same approach as Android on Linux.

```bash
# App setup script — install_ios_app.sh
xcrun simctl boot "iPhone 15"
open -a Simulator
xcrun simctl install booted path/to/YourApp.app
```

The agent receives a goal that mentions it is interacting with an iOS app in a simulator. It clicks, swipes (via click-drag), and types exactly as with any other app.

---

## Phase 4 — Robustness and Intelligence (Days 36–56)

**Timeline:** Days 36–56 (Weeks 6–8)
**Goal:** Make the agent robust enough for real-world design partner use. Add file generation, voice assertions, multi-step memory, and retry intelligence.

### Agent robustness

**Stuck detection and retry loop:**

```typescript
// In agent loop — after each action
const beforeScreenshot = await adapter.getScreenshot();
await adapter.execute(action);
await sleep(3000);
const afterScreenshot = await adapter.getScreenshot();

const pixelDelta = compareScreenshots(beforeScreenshot, afterScreenshot);
if (pixelDelta < 0.01) {
	// Screen didn't change — try an alternative approach
	retryCount++;
	if (retryCount >= 3) {
		return { success: false, reason: "agent stuck — no screen change after 3 retries" };
	}
	workingMemory.push("Last action had no visible effect. Try a different approach.");
}
```

**Expanded action vocabulary:**

- `scroll(nx, ny, direction, clicks)` — scroll wheel
- `shortcut(keys)` — keyboard shortcuts e.g. `['ctrl', 's']`
- `drag(fromX, fromY, toX, toY)` — click-drag for swipe simulation
- `rightClick(nx, ny)` — context menu
- `doubleClick(nx, ny)` — double-click

**System dialog handling** — added to agent system prompt:

```markdown
## Handling system dialogs

If you see a Windows UAC prompt, click "Yes" to approve.
If you see a macOS permission dialog asking for microphone or file access, click "Allow" or "OK".
If you see a file picker dialog, navigate to the path specified in your goal.
If you see an unexpected error dialog, capture its text in your summary and report done(success=false).
```

### File generation capability

```typescript
interface FileAssertionCapability {
	assertFileExists(vmPath: string, timeoutMs: number): Promise<void>;
	assertFileContains(vmPath: string, pattern: string | RegExp): Promise<void>;
	assertFileSize(vmPath: string, minBytes: number): Promise<void>;
	captureFile(vmPath: string, runId: string): Promise<string>; // returns storage URL
}
```

Implementation: the VM adapter gains two additional methods:

- `readFile(vmPath)` — reads a file from the VM filesystem (SCP for Linux/macOS, RDP clipboard or SMB share for Windows)
- `listFiles(vmDir)` — lists a directory

### Voice / audio assertion

```typescript
async function assertTranscript(pcmBytes: Buffer, expected: string, confidenceThreshold = 0.85): Promise<void> {
	// Run Whisper locally in the agent container
	const transcript = await whisper.transcribe(pcmBytes);

	// Semantic match via embedding similarity — not exact string
	const similarity = await embeddings.cosineSimilarity(transcript, expected);

	if (similarity < confidenceThreshold) {
		throw new AssertionError(`Audio output mismatch. Expected: "${expected}". Got: "${transcript}". Similarity: ${similarity}`);
	}
}
```

### Multi-step memory

Long flows (10+ steps) risk context window overflow. The agent maintains compact working memory:

- After each step, the agent writes a one-sentence summary
- The last 10 summaries are included in every LLM call
- Only the current and previous screenshot are sent to the LLM — not the full history
- Full screenshot history is stored in Supabase for replay but not included in LLM context

---

## Phase 5 — Observer Engine and Supabase integration (Days 57–70)

**Timeline:** Days 57–70 (Weeks 9–10)
**Goal:** Close the loop so **affected flows already stored in Supabase** can trigger **computer-use** runs, and results land in **`test_runs`** (and related metrics) alongside other agents.

**Already in the monorepo:** `@perceo/observer-engine` performs bootstrap (via managed API and/or **`apps/temporal-worker`** workflows) and **change analysis** from Git diffs; **`flows` / `personas` / `steps`** are the system of record. There is no separate “flow graph DB” package in this repo yet—Neo4j integration is optional/engine-level per observer config.

Phases 1–4 describe building the execution plane. Phase 5 wires **impact analysis output** (affected `flow` IDs or names) to the **desktop coordinator**, which **materializes `FlowManifest`** from DB rows + config, runs VMs, then **writes `test_runs`** with `agent_type = 'computer-use'` and updates **`flow_metrics`** synthetic fields where applicable.

### Integration points

- **Input:** Observer Engine / CI passes **project id** + **affected flow ids** (from `perceo ci analyze` or managed API)—not a directory of JSON manifest files.
- **Materialization:** `JOIN flows` → **`flow_computer_use`** (and `personas`, optional `steps` as hints). Project-level defaults (e.g. default VM pool) can still live in `.perceo/config.json` or env if needed.
- **Optional LLM pass:** Generate or refine `flow_computer_use.goal` / `success_criteria` from diff + `flows.description` + `graph_data` when those columns are empty.
- **Coordinator** reads `flow_computer_use.vm_type` (and snapshot/repo fields) directly—no inference from unstructured JSON.
- **Output:** Persist **`test_runs`**; append screenshots to `test_runs.screenshots`; optional **`flow_metrics`** synthetic updates; PR comments / dashboard as in Phase 1.
- **Future:** Flow graph (Neo4j) updates remain consistent with `CLAUDE.md` / observer-engine deps—do not assume it exists for first ship.

### Auto-manifest generation

```typescript
async function generateManifestFromDiff(diffHunk: string, existingFlow: FlowGraphNode): Promise<FlowManifest> {
	const response = await llm.call({
		system: "You generate Perceo flow manifests from code diffs and flow graph context.",
		prompt: `
      Code diff: ${diffHunk}
      Existing flow: ${JSON.stringify(existingFlow)}

      Generate a FlowManifest JSON with goal and successCriteria that would validate
      the user-facing behavior affected by this diff. Be specific about what the agent
      should observe to consider the flow passed or failed.
    `,
	});

	return JSON.parse(response);
}
```

---

## Technical Requirements

### Performance targets


| Metric                                         | Target                                               |
| ---------------------------------------------- | ---------------------------------------------------- |
| Screenshot capture latency                     | < 300ms per frame                                    |
| Agent step cycle time                          | < 5s (screenshot + LLM call + input injection)       |
| VM snapshot restore time (installed flow)      | < 15s from trigger to agent-ready                    |
| Repo flow startup time (clone + build + start) | < 60s for typical Node/Python app                    |
| PR test total time (20 flows, mixed)           | < 8 minutes with parallel VM execution               |
| Dashboard frame refresh lag                    | < 2s from agent action to live view update           |
| Coordinator re-plan latency                    | < 10s from failure detection to new agent dispatched |


### Tech stack


| Component              | Technology                                             |
| ---------------------- | ------------------------------------------------------ |
| Orchestration          | Temporal Cloud                                         |
| Database + Realtime    | Supabase (Postgres + Realtime)                         |
| File storage           | Supabase Storage                                       |
| Agent LLM              | `claude-sonnet-4-6` (vision input, action JSON output) |
| Dashboard              | Next.js on Vercel                                      |
| Windows transport      | pyrdp or freerdp                                       |
| Linux transport        | xdotool + Xvfb + python-vnc                            |
| macOS transport        | VNC + cliclick                                         |
| Audio (Windows)        | Virtual Audio Cable (VB-Audio)                         |
| Audio (Linux)          | PulseAudio null sink                                   |
| Audio (macOS)          | BlackHole                                              |
| Voice STT (assertions) | Whisper (local, runs in agent container)               |
| Video replay           | ffmpeg (stitch JPEG frames to MP4)                     |
| Monorepo               | Turborepo + pnpm                                       |


### Monorepo structure

**As of this writing (implemented):**

```
perceo-package-monorepo/
├── apps/
│   ├── cli/                      # @perceo/perceo — login, init, watch, ci analyze
│   ├── temporal-worker/          # Temporal worker — bootstrapProjectWorkflow, activities, Supabase persistence
│   └── computer-use-agent/       # PRD + (future) agent / prompts / worker entrypoints
├── packages/
│   ├── observer-engine/           # Bootstrap, change analysis, Temporal client, optional Neo4j/event bus
│   ├── supabase/                 # Types + PerceoDataClient — flows, steps, test_runs, etc.
│   ├── ui/                       # Shared UI components
│   ├── eslint-config/
│   └── typescript-config/
├── supabase/migrations/           # Postgres schema (flows, steps, test_runs, …)
└── .perceo/config.json            # Per-project behavior config (not flow definitions)
```

**Planned additions for computer-use (not in repo yet):**

```
├── packages/  (or under apps/computer-use-agent/)
│   ├── agent/                     # Universal agent loop + prompts + telemetry
│   └── vm-adapters/               # windows.ts, linux.ts, macos.ts
├── apps/temporal-worker/src/workflows/
│   └── computer-use-run.workflow.ts   # Example: desktop run orchestration
└── scripts/vm-setup/ …          # Snapshot scripts as in earlier phases
```

Optional **`.perceo/flows/*.json`** exports for dev/CI—not the canonical store; **Supabase remains source of truth** unless product direction changes.

### Supabase schema

**Implemented today** (see `supabase/migrations/`): core tables include **`projects`**, **`personas`**, **`flows`** (with `graph_data` jsonb, `priority`, `persona_id`, …), **`steps`**, **`flow_metrics`**, **`test_runs`** (`status`, `screenshots` jsonb, `video_url`, `agent_type`, `pr_number`, `commit_sha`, …), **`analytics_events`**, and **`project_members`**. Types are mirrored in `@perceo/supabase` (e.g. `Flow`, `Step`, `TestRun`).

**To add for computer-use:** migrate in the **`flow_computer_use`** table defined under [Recommended table: flow_computer_use](#recommended-table-flow_computer_use); extend **`@perceo/supabase`** types and `PerceoDataClient` accordingly.

**Optional / later tables** (not required for first ship—design aids for Realtime step streaming or shared app catalog):

```sql
-- Optional: fine-grained realtime step stream (could also fold into test_runs.logs jsonb)
create table telemetry_events (
  id                uuid primary key default gen_random_uuid(),
  test_run_id       uuid references test_runs(id),
  flow_id           uuid references flows(id),
  vm_id             text not null,
  step_index        integer not null,
  action_type       text not null,
  success           boolean,
  screenshot_url    text,
  coordinator_event text,
  created_at        timestamptz default now()
);
-- alter publication supabase_realtime add table telemetry_events;

```

Repo and install metadata for desktop runs lives on **`flow_computer_use`**; a separate `app_sources` catalog is **optional** only if many flows share one identical repo profile (denormalize first; normalize when duplication hurts).

When shipping computer-use, **prefer `test_runs` + `flow_computer_use`**; add `telemetry_events` only if Realtime per-step streaming needs a normalized stream.

### Security and isolation

- Each VM run restores from a clean snapshot — no state bleeds between test runs or tenants
- App setup scripts run in isolated VMs, never on the agent host
- API keys and secrets injected at VM provisioning time via Temporal secrets, never stored in manifests
- Screenshot streams scoped per run and per organization — no cross-tenant access
- Agent LLM calls use the Anthropic API; no screenshot data logged beyond standard API usage

---

## Success Metrics

### Phase 1 exit criteria (Day 14)

- Agent completes a real native Windows app flow (installed type) end-to-end without human intervention
- Agent completes a GitHub repo flow end-to-end — clone, build, start, test, report
- Coordinator correctly distinguishes installed vs repo flows and runs the refresh cycle only for repo flows
- Coordinator successfully dispatches and aggregates results from 3+ parallel flows
- GitHub PR comment posted automatically with pass/fail per flow
- Live desktop view visible in dashboard during a run, including the build/start phase for repo flows
- Snapshot restore + agent ready in under 15 seconds (installed); under 60 seconds including build (repo)
- Agent correctly handles at least one unexpected UI element (a dialog) without failing

### Phase 3 exit criteria (Day 35)

- Same flow definition runs on Windows, Linux, and macOS with zero agent code changes
- Android app test passing on Linux VM
- iOS Simulator test passing on macOS runner
- Audio injection + transcript assertion working on all three OS targets

### Product-level metrics (90 days post-launch)


| Metric                         | Target                                                    |
| ------------------------------ | --------------------------------------------------------- |
| Flow completion rate           | > 90% without human intervention                          |
| False positive rate            | < 5%                                                      |
| Mean time to detect regression | < 10 minutes from PR open                                 |
| Time to first flow test        | < 20 minutes from Perceo install                          |
| Design partner adoption        | 3+ partners running on real PRs within 60 days of Phase 1 |
| VM cold start (post-snapshot)  | < 15 seconds                                              |
| Agent step cycle               | < 5 seconds median                                        |


---

## Open Questions

**VM hosting for Windows**
EC2 (simple, immediately available, ~$0.10/hr for `t3.medium`) vs. Hyper-V on a dedicated box (lower latency, fixed cost after hardware). For the 2-week sprint, EC2 is the right call — defer the hosting decision until Phase 1 is working and you have latency benchmarks.

**RDP library choice**
`pyrdp` provides full programmatic RDP control from Python. `freerdp` with `--plugin rdpei` is the alternative. The Day 3 benchmark settles this — pick whatever gives sub-100ms click-to-frame latency.

**Agent prompt versioning**
The LLM system prompt is the most iterated-on artifact in the system. **Once the agent package exists**, colocate it (e.g. `packages/agent/src/prompts/agent-system.md` or `apps/computer-use-agent/prompts/`) and version it like code. Today, prompts for bootstrap live under `apps/temporal-worker/src/prompts/`—a different concern from the desktop agent.

**Multi-tenant VM pools**
For design partners, each customer's app snapshots must be isolated in separate VMs. The coordinator needs to route flows to customer-scoped VM pools. Phase 4+ concern — for now, one VM pool per environment is sufficient.

**Cost model**
Each agent step makes one Claude API call (vision + ~~500 token output). At $3/M input tokens with a 1024px screenshot (~~800 tokens) plus step context (~200 tokens), that is roughly $0.003 per step. A 20-step flow costs ~$0.06 in LLM fees plus VM time. Well within acceptable range for CI testing.

---

## Appendix: Example Flow Manifest — installed app

Examples below are **serialized `FlowManifest`** for readability; in production they should be **read from Supabase `flows`** (and related config), not checked in as the primary definition. For a pre-built binary like Whisper desktop, the app is installed into the snapshot once; the coordinator restores it and hands off to the agent immediately.

```json
{
	"flowId": "whisper-transcribe-audio-file",
	"name": "Whisper: transcribe uploaded audio file",
	"vmType": "windows",
	"appSnapshot": "whisper-desktop-v3-installed",
	"appSource": {
		"type": "installed",
		"appSetupScript": "scripts/vm-setup/install-whisper-windows.ps1"
	},
	"goal": "Open Whisper desktop, load the file at C:\\test-audio\\sample.wav, run transcription, and verify output text appears in the results panel.",
	"successCriteria": "The transcription results panel contains non-empty text. The app has not crashed or shown an error dialog.",
	"timeout": 120,
	"priority": "high"
}
```

## Appendix: Example Flow Manifest — GitHub repo

For any app that lives in a repo and needs to be built and started fresh on every test cycle. The coordinator clones/pulls, builds, starts the app, waits for the ready signal, then hands off to the agent.

```json
{
	"flowId": "my-nextjs-app-checkout",
	"name": "Next.js app: complete checkout flow",
	"vmType": "windows",
	"appSnapshot": "base-runtime",
	"appSource": {
		"type": "repo",
		"repoUrl": "https://github.com/my-org/my-app",
		"branch": "main",
		"buildScript": "npm ci && npm run build",
		"startScript": "npm run start",
		"startedWhen": "port:3000",
		"envSecrets": ["DATABASE_URL", "STRIPE_SECRET_KEY"],
		"runtimeSnapshot": "base-runtime",
		"cacheStrategy": "deps-only"
	},
	"goal": "Navigate to the app at http://localhost:3000, add a product to the cart, complete the checkout flow, and verify the order confirmation page appears.",
	"successCriteria": "An order confirmation page is visible with a non-empty order number. No error pages or crashed states.",
	"timeout": 180,
	"priority": "high"
}
```

## Appendix: Runtime base snapshot script (Windows)

This script builds the `base-runtime` snapshot. It is run once to create the snapshot and should be idempotent. It does not install any specific app — that is done either by a separate `appSetupScript` (installed flows) or by the coordinator's `repoRefreshActivity` (repo flows).

```powershell
# install_base_runtime_windows.ps1
# Creates the base-runtime snapshot: OS + RDP + VAC + Node + Python + Git + build tools
# Run once. Must be idempotent.

Set-ExecutionPolicy Bypass -Scope Process -Force

# --- Chocolatey ---
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
  [System.Net.ServicePointManager]::SecurityProtocol = `
    [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
  iex ((New-Object System.Net.WebClient).DownloadString(
    'https://community.chocolatey.org/install.ps1'))
}

# --- Audio ---
choco install vb-audio-virtual-cable -y

# --- Runtimes ---
choco install nodejs-lts -y        # Node.js LTS + npm
choco install python311 -y         # Python 3.11 + pip
choco install git -y               # Git (adds git to PATH)

# --- Build tools ---
choco install visualstudio2022buildtools -y  # MSBuild, MSVC (needed for native npm modules)
npm install -g pnpm typescript ts-node       # Global Node tooling

# --- Verify ---
node --version
python --version
git --version
pnpm --version

Write-Host "base-runtime setup complete. Take snapshot now."
# Next step: shut down VM, take snapshot named 'base-runtime', restart
```

## Appendix: Agent system prompt skeleton

```markdown
# Perceo desktop agent

You are an AI agent operating a desktop computer to test software on behalf of an engineer.
You see a screenshot of the desktop and must decide what action to take next.

## Your goal

{{goal}}

## Success criteria

{{successCriteria}}

## What you know about the current context

{{workingMemory}}

## Rules

- Only take one action per response.
- Always output a valid JSON action object.
- If you are not sure what to click, describe what you see first in your reasoning.
- If you have achieved the success criteria, output done(success=true).
- If you encounter an unrecoverable error, output done(success=false) with a clear reason.
- Never guess pixel coordinates — always reason about what you see on screen.

## Action schema

\`\`\`json
{ "type": "click", "x": 0.52, "y": 0.34, "summary": "clicked the Transcribe button" }
{ "type": "type", "text": "hello world", "summary": "typed search query" }
{ "type": "scroll", "x": 0.5, "y": 0.5, "direction": "down", "clicks": 3, "summary": "scrolled results list" }
{ "type": "shortcut", "keys": ["ctrl", "s"], "summary": "saved the file" }
{ "type": "done", "success": true, "reason": "transcription text appeared in results panel" }
{ "type": "done", "success": false, "reason": "app crashed with error dialog" }
\`\`\`

## Handling system dialogs

- Windows UAC prompt → click "Yes"
- macOS permission dialog → click "Allow"
- File picker → navigate to the path in your goal
- Unexpected error dialog → capture the error text and output done(success=false)
```

---

*Perceo — Test intelligently, with the data required to do so.*
*The agent sees what users see. It does what users do. It knows when something is wrong before users do.*