# Docker Networking Issues - Quick Fix Guide

If you're seeing this error when deploying Edge Functions:

```
failed to add the host (vetha07bca2) <=> sandbox (veth4d0a57a) pair interfaces: operation not supported
```

This is a Docker networking limitation that occurs when:

- Running inside another Docker container
- Using certain Docker network configurations
- Running on systems with restricted networking

## 🚀 Quick Solutions (Pick One)

### ✅ Solution 1: Deploy from Host Machine (Recommended)

If you're inside a Docker container or Dev Container:

```bash
# Exit the container
exit

# Deploy from your host machine
cd /path/to/perceo-package-monorepo
pnpm functions:deploy
```

### ✅ Solution 2: Manual Deployment via Dashboard

Use the interactive guide:

```bash
pnpm functions:deploy:manual
```

This will:

1. Show you the secrets to add in Supabase Dashboard
2. Guide you through creating functions via web UI
3. No Docker needed!

### ✅ Solution 3: Deploy via Supabase Dashboard

**Manual steps:**

1. **Set Secrets:**
    - Go to: https://supabase.com/dashboard
    - Navigate to your project → Settings → Edge Functions
    - Click "Manage secrets"
    - Add all secrets from `.env.deploy`

2. **Create Functions:**
    - Go to: Edge Functions → Create function
    - Function name: `bootstrap-project`
    - Copy code from: `supabase/functions/bootstrap-project/index.ts`
    - Click "Deploy function"
    - Repeat for `query-workflow`

### ✅ Solution 4: GitHub Actions (Best for Production)

Set up automated deployment - no local Docker needed!

Add this to `.github/workflows/deploy-functions.yml`:

```yaml
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
            - uses: actions/checkout@v4

            - name: Setup Node
              uses: actions/setup-node@v4
              with:
                  node-version: 18

            - name: Install Supabase CLI
              run: npm install -g supabase

            - name: Deploy Functions
              env:
                  SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
                  SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}
              run: |
                  supabase functions deploy bootstrap-project --project-ref $SUPABASE_PROJECT_REF
                  supabase functions deploy query-workflow --project-ref $SUPABASE_PROJECT_REF
```

## 🔍 Why This Happens

The Supabase CLI uses Docker to bundle and test Edge Functions before deploying. When you're already inside a Docker container:

- **Docker-in-Docker** networking can be complex
- Network bridge interfaces may not be supported
- Some operations require privileged access

The CLI tries to create virtual network interfaces (`veth` pairs), which may be restricted in your environment.

## 🛠️ Technical Details

The deployment script now:

- Sets `DOCKER_DEFAULT_PLATFORM=linux/amd64` for compatibility
- Uses `--no-verify-jwt` to skip local Docker verification
- Provides clear error messages with alternative solutions

However, if your environment doesn't support Docker networking, the alternatives above bypass Docker entirely.

## ✅ Verification

After deploying via any method, verify with:

```bash
# List functions
supabase functions list --project-ref YOUR_PROJECT_REF

# View logs
supabase functions logs bootstrap-project --project-ref YOUR_PROJECT_REF

# Test from CLI
perceo init
```

## 📚 Additional Resources

- [Supabase Edge Functions Docs](https://supabase.com/docs/guides/functions)
- [Docker Networking Guide](https://docs.docker.com/network/)
- [Full Deployment Guide](./DEPLOY.md)

---

**TL;DR:** Deploy from outside Docker or use the Supabase Dashboard. 🎯
