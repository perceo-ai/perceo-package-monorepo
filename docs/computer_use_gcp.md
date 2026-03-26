# Computer use on Google Cloud — deploy and test

This document describes how the Perceo **computer-use** stack fits together after the implementations in:

- `apps/computer-use-agent` — types, vision loop, HTTP VM bridge client, manifest materialization
- `apps/temporal-worker` — `computerUseRunWorkflow`, GCP instance warm-up, Anthropic vision, Supabase writes
- `supabase/migrations/20260325120000_computer_use_flow_and_storage.sql` — `flow_computer_use`, `telemetry_events`, `computer-use` storage bucket

High-level data path:

1. Flow desktop config lives in Postgres (`flows` + `flow_computer_use`).
2. HTTP API starts Temporal `computerUseRunWorkflow`.
3. Worker optionally starts a **Google Compute Engine** Windows VM (mapped from snapshot name).
4. Worker talks to a small **HTTP bridge** colocated with the desktop (RDP/pyrdp/FreeRDP implementation is outside this repo).
5. Screenshots and step metadata go to **Supabase Storage** and **telemetry_events**; summary ends up on **test_runs**.

---

## Prerequisites

- Supabase project with migrations applied (including `20260325120000_computer_use_flow_and_storage.sql`).
- Temporal Cloud (or self-hosted) namespace and task queue used by `apps/temporal-worker`.
- Google Cloud project with:
  - Compute Engine API enabled
  - A **Windows Server** VM with RDP, your app snapshot, and (when you add audio) Virtual Audio Cable or equivalent
  - Service account for the worker with at least: `compute.instances.get`, `compute.instances.start`, `compute.instances.list` on the target instances
- Anthropic API key for vision (`PERCEO_ANTHROPIC_API_KEY`).
- **HTTP bridge** reachable from where the Temporal worker runs (`PERCEO_VM_BRIDGE_URL`), implementing the routes documented in `HttpWindowsVmBridge` inside `apps/computer-use-agent/src/adapters/http-windows-bridge.ts`.

---

## One-time: GCP Windows runner

1. Create a Windows Server VM (e.g. `e2-standard-4` in `us-central1-a`). Enable RDP (IAP TCP forwarding is strongly recommended instead of a public RDP IP).
2. Install your baseline (Node, Python, Git, test app, etc.) and create **Machine Images** or **snapshots** named consistently with `flow_computer_use.vm_snapshot_name` / `runtime_snapshot_name`.
3. Note **project id**, **zone**, and **instance name** (or one instance per snapshot, see mapping below).
4. Create a service account key JSON; the worker uses [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials) via:

   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
   ```

   or attach the service account to the worker if you run on **Cloud Run** / **GKE**.

5. Map logical snapshot names to instance names (one mapping entry per snapshot you reference from Supabase):

   ```bash
   export PERCEO_GCE_INSTANCE_BY_SNAPSHOT_JSON='{"base-runtime":"perceo-win-runner-1","whisper-desktop-v3-installed":"perceo-win-whisper-1"}'
   ```

   Or use a single fallback instance:

   ```bash
   export PERCEO_GCE_WINDOWS_INSTANCE_NAME=perceo-win-runner-1
   ```

---

## HTTP VM bridge (required)

The worker does not speak RDP directly. Run a small HTTP service **next to** the Windows desktop (same VPC, sidecar container, or SSH tunnel) that implements:

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/screenshot` | — | `image/jpeg` |
| POST | `/click` | `{ "x": number, "y": number }` pixels | 204/empty |
| POST | `/type` | `{ "text": string }` | 204 |
| POST | `/scroll` | `{ "x", "y", "direction", "clicks" }` | 204 |
| POST | `/shortcut` | `{ "keys": string[] }` | 204 |
| POST | `/inject-audio` | `{ "filepath": string }` | 204 |
| POST | `/capture-audio` | `{ "durationMs": number }` | raw PCM |
| GET | `/resolution` | — | `{ "width", "height" }` |

Set:

```bash
export PERCEO_VM_BRIDGE_URL=https://your-bridge.internal:8443
```

Optional auth header support can be added in `HttpWindowsVmBridge` if needed.

---

## Supabase configuration

1. Apply migrations (includes `flow_computer_use`, `telemetry_events`, bucket `computer-use`).
2. Insert a row in `flow_computer_use` for each eligible `flow_id` (see PRD / migration comments for `installed` vs `repo` invariants).
3. Create or update a **project API key** with scope **`computer-use:run`** or **`workflows:start`** (both are accepted by `validateComputerUseWorkflowStartActivity`).

Storage object paths are:

`{project_id}/{test_run_id}/step-{n}.jpg`

Authenticated users read objects when the first path segment matches a project they belong to (see migration policies).

---

## Temporal worker environment

Set alongside existing worker vars (`PERCEO_TEMPORAL_*`, `PERCEO_SUPABASE_*`):

| Variable | Purpose |
|----------|---------|
| `PERCEO_ANTHROPIC_API_KEY` | Vision LLM |
| `PERCEO_COMPUTER_USE_MODEL` | Optional override (default `claude-sonnet-4-20250514`) |
| `PERCEO_COMPUTER_USE_MAX_STEPS` | Max agent steps per flow (default `50`) |
| `PERCEO_VM_BRIDGE_URL` | Base URL of HTTP bridge |
| `PERCEO_VM_ID` | Label stored in telemetry (default `gce-windows`) |
| `PERCEO_GCP_PROJECT_ID` | GCP project |
| `PERCEO_GCE_ZONE` | e.g. `us-central1-a` |
| `PERCEO_GCE_INSTANCE_BY_SNAPSHOT_JSON` | Snapshot → instance map (JSON) |
| `PERCEO_GCE_WINDOWS_INSTANCE_NAME` | Fallback instance if map misses |
| `PERCEO_GCE_SKIP` | `true` / `1` — skip GCE start (local dev) |

---

## Local / staging test (without GCP)

1. Apply migrations to a dev Supabase project.
2. Seed `flow_computer_use` + grab `flow.id` values.
3. Run **Temporal worker** with:

   ```bash
   export PERCEO_GCE_SKIP=true
   export PERCEO_VM_BRIDGE_URL=http://localhost:9333
   export PERCEO_ANTHROPIC_API_KEY=sk-ant-...
   ```

4. Run a mock or real bridge on `9333` that returns JPEG frames from your desktop or a fixture.
5. Start workflow via HTTP:

   ```bash
   curl -sS -X POST "http://localhost:8080/api/workflows/computer-use-run" \
     -H "Content-Type: application/json" \
     -H "x-api-key: $PERCEO_WORKER_API_KEY" \
     -d '{
       "projectId": "<uuid>",
       "flowIds": ["<flow-uuid>"],
       "workflowApiKey": "prc_..."
     }'
   ```

6. Poll status:

   ```bash
   curl -sS "http://localhost:8080/api/workflows/<workflowId>" \
     -H "x-api-key: $PERCEO_WORKER_API_KEY"
   ```

7. In Supabase, check `test_runs`, `telemetry_events`, and Storage bucket `computer-use`.

---

## Production deploy (outline)

1. **Worker**: Deploy `apps/temporal-worker` to Cloud Run, GKE, or a VM that can reach Temporal, Supabase, Anthropic, the VM bridge, and GCP Compute API. Set env vars from the tables above. Use Workload Identity or a secret-mounted `GOOGLE_APPLICATION_CREDENTIALS` instead of committing keys.
2. **Bridge**: Deploy beside the Windows runner (same VPC). Restrict ingress to the worker’s egress IPs or use VPC / IAP.
3. **Windows VM**: Prefer IAP for RDP. Keep disks/immutable snapshots per app as required by your flows.
4. **Secrets**: Repo `envSecrets` in manifests are **names only**; resolve via `getProjectSecretActivity` when you wire `repoRefreshActivity` (clone/build/start on the VM is not yet fully implemented in the worker).

---

## Operational notes

- **Repo flows**: `repoRefreshActivity` in `apps/computer-use-agent` is ready for Temporal to call; orchestration on the Windows host (PowerShell, Git, ports) still needs platform-specific activities when you go beyond installed snapshots.
- **Linux/macOS**: Agent types support `vm_type`; the worker currently throws for non-`windows` until Linux adapters and GCP mapping exist.
- **Cost / latency**: Prefer pre-warmed instances and snapshot mapping (PRD: wall-clock over VM cost). Increase parallelism by fan-out workflows or multiple activities once instance pools are ready.

---

## Related paths

- PRD: `apps/computer-use-agent/Perceo_ComputerUse_PRD_v1.md`
- Worker entry + routes: `apps/temporal-worker/src/index.ts`
- Workflow: `apps/temporal-worker/src/workflows/computer-use-run.workflow.ts`
