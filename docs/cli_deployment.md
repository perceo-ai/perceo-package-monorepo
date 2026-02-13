## Perceo CLI Deployment Guide

**Version:** 2.0  
**Date:** February 12, 2026  
**Status:** Zero-Config Deployment (embedded credentials, automatic CI setup)

---

### 1. Overview

This guide explains how to deploy the Perceo CLI with **zero configuration required**. The CLI now has **embedded Perceo Cloud credentials** and can **automatically configure GitHub Actions** via OAuth.

**For 99% of users: No environment variables needed.**

Components involved:

- **Perceo CLI** (`@perceo/perceo`) — runs in your app repo and in CI with embedded credentials.
- **Perceo Cloud**: Managed Supabase backend (embedded), Flow discovery, Change analysis.
- **GitHub Actions**: Automatically configured via GitHub OAuth (optional).

Architecture details: `[docs/cli_architecture.md](./cli_architecture.md)` and `[docs/cli_managed_services.md](./cli_managed_services.md)`.

---

### 2. Zero-Config Quick Start

#### 2.1 Install and Login

```bash
# Install CLI globally
npm install -g @perceo/perceo

# Login (uses embedded Perceo Cloud credentials)
perceo login

# Initialize your project
perceo init
```

That's it! The CLI will:
1. ✅ Connect to Perceo Cloud (no env vars needed)
2. ✅ Discover flows in your codebase
3. ✅ Generate a CI API key
4. ✅ Auto-configure GitHub Actions (with your permission)

#### 2.2 What Happens During Init

When you run `perceo init`, the CLI:

1. **Connects to Perceo Cloud** using embedded credentials
2. **Discovers flows** from your codebase structure
3. **Creates a project** in Perceo Cloud
4. **Generates a CI API key** for GitHub Actions
5. **Detects your GitHub repository** from git remote
6. **Asks permission** to auto-configure GitHub Actions
7. **Authorizes via GitHub OAuth** (device flow - you authorize in browser)
8. **Creates the `PERCEO_API_KEY` secret** in your GitHub repository
9. **Generates `.github/workflows/perceo.yml`** workflow file
10. **Done!** Just commit and push

#### 2.3 Manual Setup (if auto-config is skipped)

If you choose not to auto-configure GitHub, you'll need to:

1. Copy the displayed `PERCEO_API_KEY` value
2. Add it as a GitHub secret: **Settings → Secrets and variables → Actions → New repository secret**
3. Commit the generated `.github/workflows/perceo.yml` file

---

### 3. Configuration Model

#### 3.1 What's Embedded vs Configurable

| What | Where | Notes |
|------|-------|-------|
| **Perceo Cloud URL** | Embedded in CLI | Override with `PERCEO_SUPABASE_URL` for self-hosted |
| **Perceo Cloud Anon Key** | Embedded in CLI | Override with `PERCEO_SUPABASE_ANON_KEY` for self-hosted |
| **User Auth Tokens** | `~/.perceo/auth.json` or `.perceo/auth.json` | Stored locally after `perceo login` |
| **Project Config** | `.perceo/config.json` | Safe to commit (no secrets) |
| **CI API Key** | GitHub Secrets (auto-created) | Project-scoped, managed via `perceo keys` |

#### 3.2 Environment Variables (Only for Advanced Use Cases)

**Most users don't need any environment variables.** These are only for self-hosted or advanced configurations:

**Self-Hosted Perceo (Override Embedded Credentials)**

| Variable | When Needed | Description |
|----------|-------------|-------------|
| `PERCEO_SUPABASE_URL` | Self-hosted only | Your Supabase instance URL |
| `PERCEO_SUPABASE_ANON_KEY` | Self-hosted only | Your Supabase anon key |
| `PERCEO_SUPABASE_SERVICE_ROLE_KEY` | Server-side operations | Service role key for admin operations |

**GitHub OAuth (For CLI Development)**

| Variable | When Needed | Description |
|----------|-------------|-------------|
| `PERCEO_GITHUB_CLIENT_ID` | CLI development | GitHub OAuth App client ID |

**Optional Features**

| Variable | Description |
|----------|-------------|
| `PERCEO_ENV` | `local` \| `dev` \| `staging` \| `production` (affects logging/behavior) |
| `PERCEO_CONFIG_PATH` | Override path to config file (absolute or relative to project) |
| `PERCEO_TEMPORAL_ENABLED` | Enable Temporal workflows (see section 6) |

---

### 4. GitHub Actions CI

#### 4.1 Automatic Configuration (Recommended)

When you run `perceo init`, if a GitHub remote is detected:

1. CLI asks: "Auto-configure GitHub Actions?"
2. You authorize in your browser via GitHub OAuth
3. CLI creates the `PERCEO_API_KEY` secret automatically
4. CLI creates `.github/workflows/perceo.yml`
5. Done! Just commit and push

The workflow runs on every PR and analyzes which flows are affected by your changes.

#### 4.2 Manual Configuration

If you skipped auto-config or want to configure manually:

**Step 1: Add the API Key Secret**

1. Go to your repository on GitHub
2. Navigate to **Settings → Secrets and variables → Actions**
3. Click **New repository secret**
4. Name: `PERCEO_API_KEY`
5. Value: (the key displayed during `perceo init`)
6. Click **Add secret**

**Step 2: Commit the Workflow File**

The workflow file is already created at `.github/workflows/perceo.yml`. Just commit it:

```bash
git add .github/workflows/perceo.yml .perceo/
git commit -m "Add Perceo CI"
git push
```

#### 4.3 Managing API Keys

Use the `perceo keys` command to manage your project's API keys:

```bash
# List all API keys
perceo keys list

# Create a new API key
perceo keys create --name jenkins --scopes ci:analyze,ci:test

# Revoke an API key
perceo keys revoke prc_abc12345 --reason "Rotating keys"
```

**Available Scopes:**
- `ci:analyze` - Run `perceo ci analyze`
- `ci:test` - Run `perceo ci test`
- `flows:read` - Read flow definitions
- `flows:write` - Create/update flows
- `insights:read` - Read insights
- `events:publish` - Publish events

---

### 5. Local Development

#### 5.1 Running Perceo Locally

No environment variables needed! Just:

```bash
# Watch for changes and analyze (with embedded credentials)
perceo watch --dev --analyze

# Analyze specific changes
perceo analyze --base main --head HEAD

# View flows
perceo flows list
```

#### 5.2 Self-Hosted Setup (Advanced)

If you're running your own Perceo backend:

1. Create a `.env` file (git-ignored):

```bash
# .env
PERCEO_SUPABASE_URL=https://your-instance.supabase.co
PERCEO_SUPABASE_ANON_KEY=your_anon_key
PERCEO_SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

2. Load env before running CLI:

```bash
source .env
perceo init
```

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

#### 6.2 Environment Variables for Temporal

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PERCEO_TEMPORAL_ENABLED` | Enable Temporal workflows | `false` | No |
| `PERCEO_TEMPORAL_ADDRESS` | Temporal server address | `localhost:7233` | When enabled |
| `PERCEO_TEMPORAL_NAMESPACE` | Temporal namespace | `perceo` | No |
| `PERCEO_TEMPORAL_TASK_QUEUE` | Task queue name | `observer-engine` | No |
| `PERCEO_TEMPORAL_TLS_CERT_PATH` | mTLS cert path (production) | - | For production |
| `PERCEO_TEMPORAL_TLS_KEY_PATH` | mTLS key path (production) | - | For production |

See `apps/temporal-worker/README.md` for detailed worker documentation.

---

### 7. Migration from Previous Version

#### 7.1 Upgrading from v1.x

If you were using Perceo v1.x with manual environment variables:

**What changed:**
- ✅ `PERCEO_SUPABASE_URL` and `PERCEO_SUPABASE_ANON_KEY` are now embedded (still overridable)
- ✅ GitHub Actions setup is now automatic via OAuth
- ✅ No `.env` file needed for local development

**Migration steps:**
1. Update CLI: `npm install -g @perceo/perceo@latest`
2. Remove local `.env` file (or keep for overrides)
3. Re-run `perceo init` to enable auto-config
4. Existing projects continue to work with no changes

**Breaking changes:**
- None! Environment variables still work as overrides

---

### 8. Security Considerations

#### 8.1 Embedded Credentials

**Q: Is it safe to embed the Supabase anon key?**
- **Yes!** Anon keys are meant to be public and are protected by Row Level Security (RLS)
- RLS policies ensure users can only access their own data
- This is the same model used by all Supabase applications

**Q: What about the API keys?**
- Project API keys are generated per-project and can be revoked anytime
- Keys are scoped with specific permissions (e.g., `ci:analyze` only)
- Keys are stored as GitHub Secrets, never in code
- Manage keys with `perceo keys list/revoke`

#### 8.2 GitHub OAuth

- Uses GitHub's recommended device flow for CLI apps
- Only requests `repo` scope (minimum required for secrets)
- Token is used once to create the secret, then discarded
- You can revoke CLI access anytime in GitHub settings

---

### 9. Troubleshooting

#### 9.1 Common Issues

**"PERCEO_SUPABASE_ANON_KEY is not configured"**
- This means the embedded key is missing (development build)
- Solution: Set `PERCEO_SUPABASE_ANON_KEY` env var temporarily
- For production builds, this should never happen

**"You must log in first"**
- Run `perceo login` before `perceo init`
- Your auth tokens may have expired - login again

**"GitHub authorization failed"**
- Check your internet connection
- GitHub may be rate-limiting - try again later
- You can skip auto-config and add the secret manually

**"Insufficient permissions to write to repository"**
- You need admin or push access to the repository
- Ask a repository admin to add the secret manually
- Or, the admin can run `perceo init` themselves

#### 9.2 Getting Help

- Documentation: https://perceo.dev/docs
- GitHub Issues: https://github.com/perceo/perceo/issues
- Email: support@perceo.dev

---

### 10. Summary

**Zero-config workflow:**
1. `npm install -g @perceo/perceo`
2. `perceo login`
3. `perceo init` (auto-configures everything)
4. `git commit && git push`
5. Done! ✅

**Environment variables needed: 0 (for 99% of users)**

**Manual steps needed: 0 (with auto-config)**

Perceo is now the easiest way to add intelligent regression testing to your project!
