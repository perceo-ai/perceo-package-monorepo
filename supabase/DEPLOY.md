# Edge Functions Deployment Guide

Quick guide to deploy Perceo Edge Functions to Supabase.

## Prerequisites

1. **Supabase CLI installed:**

    ```bash
    npm install -g supabase
    ```

2. **Supabase project created:**
    - Go to [supabase.com](https://supabase.com)
    - Create a new project
    - Note your project reference (Settings → General → Reference ID)

3. **Temporal setup:**
    - Temporal Cloud account OR self-hosted Temporal
    - API key (JWT token)
    - Namespace and task queue configured

## Quick Start

### 1. Configure Deployment

```bash
# Copy the example file
cp supabase/.env.deploy.example supabase/.env.deploy

# Edit with your credentials
nano supabase/.env.deploy
```

Fill in:

- `SUPABASE_PROJECT_REF` - Your Supabase project reference ID
- `PERCEO_TEMPORAL_ADDRESS` - Temporal server address
- `PERCEO_TEMPORAL_API_KEY` - Your Temporal JWT token
- `PERCEO_TEMPORAL_NAMESPACE` - Your Temporal namespace
- `PERCEO_SUPABASE_URL` - Your Supabase URL
- `PERCEO_SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `PERCEO_OPEN_ROUTER_API_KEY` - OpenRouter API key (or Anthropic)

### 2. Login to Supabase

```bash
supabase login
```

This will open a browser for authentication.

### 3. Deploy Functions

```bash
# From project root
pnpm functions:deploy

# Or directly
bash supabase/deploy-functions.sh
```

The script will:

1. ✅ Validate all required secrets are present
2. 🔐 Set secrets in Supabase
3. 📤 Deploy both edge functions
4. ✅ Confirm successful deployment

### 4. Verify Deployment

```bash
# List deployed functions
supabase functions list --project-ref YOUR_PROJECT_REF

# View function logs
supabase functions logs bootstrap-project --project-ref YOUR_PROJECT_REF

# Test from CLI
perceo init
```

## Deployed Functions

After deployment, you'll have two functions available:

### 1. `bootstrap-project`

- **URL:** `https://YOUR_PROJECT.supabase.co/functions/v1/bootstrap-project`
- **Purpose:** Starts Temporal workflow to bootstrap project flows
- **Auth:** Requires user JWT token

### 2. `query-workflow`

- **URL:** `https://YOUR_PROJECT.supabase.co/functions/v1/query-workflow`
- **Purpose:** Queries workflow progress for real-time updates
- **Auth:** Requires user JWT token

### 3. `get-public-env`

- **URL:** `https://YOUR_PROJECT.supabase.co/functions/v1/get-public-env`
- **Purpose:** Returns public (non-secret) env key/values from the `public_env` table for CLI and new-PC setup. Used by the CLI to cache values next to auth and refresh when the CLI version changes.
- **Auth:** None (returns only rows with `public = true`; do not store secrets in `public_env`).
- **Deploy:** `supabase functions deploy get-public-env --project-ref YOUR_PROJECT_REF`
- **Secrets:** Uses built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (no extra secrets required).

## Public env table and seeding

The `public_env` table is created by migration `20260214100000_public_env.sql`. It has columns `key` (text), `value` (text), `public` (boolean). Only rows with `public = true` are returned by the `get-public-env` Edge Function.

**Seeding:** The migration seeds Perceo Cloud values for `PERCEO_SUPABASE_URL` and `PERCEO_SUPABASE_ANON_KEY`. To add or update entries (e.g. a new public API base URL), use the Supabase SQL editor or a follow-up migration:

```sql
INSERT INTO public_env (key, value, public) VALUES
  ('PERCEO_API_BASE_URL', 'https://api.perceo.ai', true)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
```

**Security:** Never store secrets (e.g. `PERCEO_API_KEY`, `PERCEO_SUPABASE_SERVICE_ROLE_KEY`, `PERCEO_WORKER_API_KEY`) in `public_env`. RLS is enabled with no anon SELECT; only the Edge Function (service role) reads the table.

**What to add (public only):**

| Key                        | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `PERCEO_SUPABASE_URL`      | Supabase project URL (already seeded)                      |
| `PERCEO_SUPABASE_ANON_KEY` | Publishable anon key (already seeded)                      |
| `PERCEO_WORKER_API_URL`    | Temporal Worker HTTP API base URL (already seeded)         |
| `PERCEO_API_BASE_URL`      | Optional: Perceo API base URL if you expose a separate API |

**Do not add:** `PERCEO_API_KEY`, `PERCEO_SUPABASE_SERVICE_ROLE_KEY`, `PERCEO_WORKER_API_KEY`, `PERCEO_ANTHROPIC_API_KEY`, `PERCEO_OPEN_ROUTER_API_KEY`, `PERCEO_TEMPORAL_API_KEY`, or any token/secret.

## Testing the Functions

### Test bootstrap-project

```bash
# Get your JWT token after running `perceo login`
JWT_TOKEN="your-jwt-token"
SUPABASE_URL="https://your-project.supabase.co"
ANON_KEY="your-anon-key"

curl -X POST "$SUPABASE_URL/functions/v1/bootstrap-project" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "test-uuid",
    "projectName": "test-app",
    "framework": "nextjs"
  }'
```

Expected response:

```json
{
	"workflowId": "bootstrap-test-uuid-1234567890",
	"message": "Bootstrap workflow started successfully"
}
```

### Test get-public-env

No auth required; returns a JSON object of public env key/values:

```bash
curl "$SUPABASE_URL/functions/v1/get-public-env"
```

Expected response (example):

```json
{
	"PERCEO_SUPABASE_URL": "https://your-project.supabase.co",
	"PERCEO_SUPABASE_ANON_KEY": "sb_publishable_..."
}
```

### Test query-workflow

```bash
WORKFLOW_ID="bootstrap-test-uuid-1234567890"

curl "$SUPABASE_URL/functions/v1/query-workflow?workflowId=$WORKFLOW_ID" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "apikey: $ANON_KEY"
```

Expected response:

```json
{
	"workflowId": "bootstrap-test-uuid-1234567890",
	"progress": {
		"stage": "extract-flows",
		"percentage": 45,
		"message": "Extracting flows...",
		"flowsExtracted": 5
	},
	"completed": false
}
```

## Updating Functions

After making changes to function code:

```bash
# Redeploy (secrets are preserved)
pnpm functions:deploy
```

## Updating Secrets

If you need to update secrets:

```bash
# Update .env.deploy with new values
nano supabase/.env.deploy

# Redeploy (will update secrets)
pnpm functions:deploy
```

## Troubleshooting

### "Supabase CLI not found"

```bash
npm install -g supabase
```

### "Missing .env.deploy"

```bash
cp supabase/.env.deploy.example supabase/.env.deploy
# Then edit with your values
```

### "Failed to set secret"

Try setting manually:

```bash
supabase secrets set PERCEO_TEMPORAL_API_KEY=your-key --project-ref YOUR_REF
```

### "Function deploy failed"

Check:

1. You're logged in: `supabase login`
2. Project ref is correct in `.env.deploy`
3. Function code has no syntax errors

### "Docker networking error" / "operation not supported"

**Error:** `failed to add the host (...) pair interfaces: operation not supported`

This happens when deploying from inside a Docker container or with certain network configurations.

**Solutions:**

1. **Deploy from host machine** (not inside container):

    ```bash
    # Exit any Docker containers first
    exit
    # Then deploy from host
    pnpm functions:deploy
    ```

2. **Use manual deployment script:**

    ```bash
    bash supabase/deploy-functions-manual.sh
    ```

    This guides you through deploying via Supabase Dashboard.

3. **Deploy via Supabase Dashboard:**
    - Go to project → Edge Functions
    - Create new function
    - Copy/paste code from `supabase/functions/*/index.ts`
    - Deploy directly from browser

4. **Use GitHub Actions** (see CI/CD section below)

### "Workflow not starting"

Check edge function logs:

```bash
supabase functions logs bootstrap-project --project-ref YOUR_REF --tail
```

Common issues:

- Invalid Temporal credentials
- Temporal server unreachable
- Missing/expired service role key

## Security Notes

⚠️ **Never commit `.env.deploy`** - It contains production secrets!

✅ `.env.deploy` is already in `.gitignore`

✅ Use different credentials for:

- Development (local `.env`)
- Production (`.env.deploy`)

## CI/CD Integration

For automated deployments:

```yaml
# .github/workflows/deploy-functions.yml
name: Deploy Edge Functions

on:
    push:
        branches: [main]
        paths:
            - "supabase/functions/**"

jobs:
    deploy:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v3

            - name: Setup Node
              uses: actions/setup-node@v3
              with:
                  node-version: 18

            - name: Install Supabase CLI
              run: npm install -g supabase

            - name: Create .env.deploy from secrets
              run: |
                  cat << EOF > supabase/.env.deploy
                  SUPABASE_PROJECT_REF=${{ secrets.SUPABASE_PROJECT_REF }}
                  PERCEO_TEMPORAL_ADDRESS=${{ secrets.PERCEO_TEMPORAL_ADDRESS }}
                  PERCEO_TEMPORAL_API_KEY=${{ secrets.PERCEO_TEMPORAL_API_KEY }}
                  # ... other secrets
                  EOF

            - name: Deploy Functions
              run: bash supabase/deploy-functions.sh
              env:
                  SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
```

## Next Steps

1. ✅ Functions deployed
2. Configure CLI environment variables for users
3. Test with `perceo init` in a project
4. Monitor function logs for any issues
5. Set up monitoring/alerts for production

For more details, see [README.md](functions/README.md).
