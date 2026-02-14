# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Perceo is an intelligent regression testing tool that uses multi-agent simulation to automatically detect affected flows and run targeted tests. The project is a Turborepo monorepo with pnpm workspaces containing:

- **CLI package** (`apps/cli`): Published as `@perceo/perceo` NPM package - the main user-facing tool
- **Observer Engine** (`packages/observer-engine`): Core analysis engine used by the CLI for flow/persona bootstrap and change impact analysis
- **Shared packages**: `eslint-config`, `typescript-config`, `ui`

## Development Commands

### Monorepo-wide commands

```bash
# Install dependencies (pnpm is required)
pnpm install

# Build all packages
pnpm build
# or
turbo build

# Lint all packages
pnpm lint

# Format code
pnpm format

# Type checking
pnpm check-types
```

### CLI development

```bash
# Build the CLI
pnpm cli:build

# Watch mode (rebuild on changes)
pnpm cli:dev

# Test the built CLI
pnpm cli:test
# or directly run:
node apps/cli/dist/index.js
```

### Individual package development

Use Turborepo filters to work on specific packages:

```bash
# Build only the CLI
turbo build --filter=@perceo/perceo

# Build only observer-engine
turbo build --filter=@perceo/observer-engine

# Dev mode for specific package
turbo dev --filter=@perceo/perceo
```

### Changesets for versioning

This project uses changesets for version management:

```bash
# Create a new changeset (run this when making changes that need to be versioned)
pnpm changeset

# Version packages (updates versions and changelogs)
pnpm changeset version

# Publish to NPM (done by CI, but can be run manually)
pnpm changeset publish
```

## Architecture

### CLI Commands

The CLI (`apps/cli`) provides these commands:

- `perceo login` / `perceo logout` - Authentication via Supabase magic link
- `perceo init` - Initialize Perceo in a project (creates `.perceo/config.json`, bootstraps flows/personas)
- `perceo watch` - Watch for code changes and trigger tests (WIP)
- `perceo ci analyze` - Analyze changes between Git refs to identify affected flows (used in CI/CD)

### Observer Engine

The `@perceo/observer-engine` package provides the core analysis logic:

- **Bootstrap**: Initialize flows and personas for a project via managed API
- **Change Analysis**: Compute Git diffs and delegate to managed API for impact analysis
- **Event Publishing**: Publishes events to event bus when configured
- **Flow Graph Integration**: Can upsert flows to Neo4j when flow graph client is provided

The engine delegates heavy computation to managed backend APIs. When APIs are not configured, it provides graceful local fallbacks.

### Configuration Model

Perceo uses a split configuration model for security:

1. **Behavior-only config** (`.perceo/config.json`): Safe to commit, contains paths, strategies, feature flags, provider names, and project id/name (which project in Perceo Cloud this repo is linked to).
2. **Secrets via environment variables**: API keys, endpoints, database credentials are NEVER in config files.

**Project access**: Only users who are members of a project can view or change that project's data. Membership is stored in Supabase (`project_members` table) and enforced by RLS. The CLI checks membership before operations (init, del, keys, analyze); the project creator is automatically added as owner. Owners and admins can add or remove members.

Key environment variables:

- `PERCEO_API_BASE_URL`, `PERCEO_API_KEY` - Managed API access
- `PERCEO_NEO4J_URI`, `PERCEO_NEO4J_DATABASE`, `PERCEO_NEO4J_USERNAME`, `PERCEO_NEO4J_PASSWORD` - Flow graph (Neo4j)
- `PERCEO_REDIS_URL` - Event bus (Redis)
- `PERCEO_SUPABASE_URL`, `PERCEO_SUPABASE_ANON_KEY` - Authentication
- `ANALYTICS_CREDENTIALS` - External analytics integration

See `docs/cli_deployment.md` for complete deployment guide.

### Key Files to Know

- `apps/cli/src/index.ts` - CLI entry point, command registration
- `apps/cli/src/commands/` - Individual command implementations
- `apps/cli/src/config.ts` - Config loading with environment variable resolution
- `apps/cli/src/auth.ts` - Authentication logic (Supabase client: `@perceo/supabase`)
- `packages/observer-engine/src/engine.ts` - Core Observer Engine class
- `packages/observer-engine/src/client.ts` - API client for managed services
- `packages/observer-engine/src/git.ts` - Git operations for change analysis

## Building and Publishing

### Local Testing

1. Build the CLI: `pnpm cli:build`
2. Test locally: `node apps/cli/dist/index.js <command>`
3. Or link globally: `cd apps/cli && pnpm link --global`, then use `perceo` directly

### Publishing

The CLI is published to NPM as `@perceo/perceo`. Publishing is automated via GitHub Actions with trusted publishing (no NPM tokens in repo). The workflow:

1. Create a changeset: `pnpm changeset`
2. Commit and push changes
3. CI automatically publishes on merge to `main` when changeset is detected

See `.github/workflows/` and `docs/cli_deployment.md` for CI/CD details.

## Testing in Consumer Projects

To test the CLI in an actual application:

1. Run `perceo login` first (authentication is required before init)
2. Run `perceo init` to create `.perceo/config.json`
3. Configure environment variables (see docs/cli_deployment.md section 3.3)
4. Run `perceo watch --dev --analyze` for local development
5. In CI: `perceo ci analyze --base <base-sha> --head <head-sha>`

## Important Notes

- **Never commit secrets**: All API keys, database credentials, and endpoints must be in environment variables, not config files
- **pnpm required**: This project uses pnpm workspaces; npm/yarn won't work correctly
- **Turborepo caching**: Turbo caches build outputs; use `--force` to rebuild from scratch if needed
- **Changesets workflow**: Always create a changeset when making version-worthy changes
- **Observer Engine is peer dependency**: When developing locally, the engine expects the CLI to be available as a peer
