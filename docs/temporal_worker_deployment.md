# Temporal Worker Deployment Guide

This guide explains how to deploy the Perceo Temporal Worker to production using GitHub Actions and Temporal Cloud.

## Overview

The Temporal Worker deployment workflow:

1. **Builds** a Docker image from the monorepo
2. **Pushes** to GitHub Container Registry (ghcr.io)
3. **Deploys** to Cloud Run (or alternative platforms)

## Prerequisites

- [ ] Temporal Cloud account with namespace created
- [ ] Temporal Cloud mTLS certificates downloaded
- [ ] Google Cloud Project (for Cloud Run deployment)
- [ ] Service account with Cloud Run permissions

## 1. Temporal Cloud Setup

### 1.1 Create Namespace

1. Log in to [Temporal Cloud](https://cloud.temporal.io)
2. Create a new namespace (e.g., `perceo-prod`)
3. Note your namespace ID and connection address

### 1.2 Generate mTLS Certificates

1. Navigate to your namespace settings
2. Go to "Certificates" section
3. Generate a new client certificate
4. Download both:
   - `client.pem` (certificate)
   - `client-key.pem` (private key)

**Important**: Keep these files secure. Never commit them to git.

## 2. Google Cloud Setup (Cloud Run)

### 2.1 Create Service Account

```bash
# Create service account
gcloud iam service-accounts create temporal-worker-deployer \
  --display-name "Temporal Worker Deployer"

# Grant Cloud Run permissions
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:temporal-worker-deployer@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"

# Grant Secret Manager permissions
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:temporal-worker-deployer@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.admin"

# Generate key
gcloud iam service-accounts keys create gcp-key.json \
  --iam-account=temporal-worker-deployer@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

### 2.2 Grant Secret Access to Cloud Run

The GitHub Actions workflow will automatically create the TLS certificate secrets in Secret Manager. You just need to grant the Cloud Run service account access to read them:

```bash
# Get your project number
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format="value(projectNumber)")

# Grant Cloud Run service account access to secrets
gcloud secrets add-iam-policy-binding temporal-cert \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  2>/dev/null || echo "Secret will be created by workflow"

gcloud secrets add-iam-policy-binding temporal-key \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  2>/dev/null || echo "Secret will be created by workflow"
```

**Note**: These commands may fail if the secrets don't exist yet - that's expected. The workflow will create them on first run, and you can run these commands again afterward to grant access.

## 3. GitHub Secrets Configuration

### 3.1 Required Secrets

Navigate to your GitHub repository → Settings → Secrets and variables → Actions → New repository secret:

| Secret Name | Description | Example Value |
|-------------|-------------|---------------|
| `GCP_SA_KEY` | Service account JSON key | `{"type": "service_account"...}` |
| `TEMPORAL_ADDRESS` | Temporal Cloud endpoint | `your-namespace.tmprl.cloud:7233` |
| `TEMPORAL_NAMESPACE` | Temporal namespace ID | `your-namespace.account-id` |
| `TEMPORAL_TLS_CERT` | Client certificate content | Contents of `client.pem` |
| `TEMPORAL_TLS_KEY` | Client private key | Contents of `client-key.pem` |
| `PERCEO_API_BASE_URL` | Perceo API base URL | `https://api.perceo.dev` |
| `PERCEO_API_KEY` | Perceo API key | `pk_live_...` |
| `NEO4J_URI` | Neo4j connection URI | `bolt://your-neo4j.com:7687` |
| `NEO4J_USERNAME` | Neo4j username | `neo4j` |
| `NEO4J_PASSWORD` | Neo4j password | `your-password` |
| `REDIS_URL` | Redis connection URL | `redis://your-redis.com:6379` |

**To add certificate secrets:**

```bash
# Copy certificate content
cat client.pem | pbcopy  # macOS
cat client.pem | xclip -selection clipboard  # Linux

# Then paste into GitHub secret value field
```

### 3.2 Optional Variables

Navigate to Settings → Secrets and variables → Actions → Variables tab:

| Variable Name | Description | Default Value |
|---------------|-------------|---------------|
| `GCP_REGION` | Cloud Run region | `us-central1` |
| `TEMPORAL_TASK_QUEUE` | Task queue name | `observer-engine` |
| `NEO4J_DATABASE` | Neo4j database name | `neo4j` |

## 4. Deployment Options

### Option A: Cloud Run (Default)

The workflow is pre-configured for Cloud Run deployment.

**Pros:**
- Serverless (no infrastructure management)
- Auto-scaling
- Pay per use
- Built-in monitoring

**Cons:**
- Must handle long-running workflows carefully
- Network egress costs

### Option B: Kubernetes

Uncomment the `deploy-kubernetes` job in the workflow and configure:

1. **Create Kubernetes secret:**

```bash
# Create kubeconfig secret
cat ~/.kube/config | base64 -w 0
# Add as GitHub secret: KUBECONFIG
```

2. **Apply Kubernetes manifests:**

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: perceo-temporal-worker
spec:
  replicas: 3
  selector:
    matchLabels:
      app: perceo-temporal-worker
  template:
    metadata:
      labels:
        app: perceo-temporal-worker
    spec:
      containers:
      - name: worker
        image: ghcr.io/your-org/your-repo/temporal-worker:latest
        env:
        - name: PERCEO_TEMPORAL_ADDRESS
          value: "your-namespace.tmprl.cloud:7233"
        volumeMounts:
        - name: temporal-tls
          mountPath: /secrets
          readOnly: true
      volumes:
      - name: temporal-tls
        secret:
          secretName: temporal-tls
```

### Option C: Other Platforms

For other platforms (AWS ECS, Azure Container Instances, etc.), adapt the deployment step:

```yaml
- name: Deploy to [Platform]
  run: |
    # Your deployment command
    # Must set environment variables
    # Must mount TLS certificates
```

## 5. Triggering Deployment

### Automatic Deployment

The workflow triggers automatically on:
- Push to `main` branch
- Changes to `apps/temporal-worker/**` or `packages/observer-engine/**`

### Manual Deployment

1. Go to Actions tab in GitHub
2. Select "Deploy Temporal Worker" workflow
3. Click "Run workflow"
4. Choose environment (production/staging)
5. Click "Run workflow"

## 6. Verification

### 6.1 Check Deployment Status

```bash
# Cloud Run
gcloud run services describe perceo-temporal-worker \
  --region us-central1 \
  --format="value(status.url)"

# Kubernetes
kubectl get deployment perceo-temporal-worker
kubectl logs -l app=perceo-temporal-worker --tail=50
```

### 6.2 Verify Worker Registration

1. Log in to Temporal Cloud
2. Navigate to your namespace
3. Click "Workers" in sidebar
4. Confirm worker is polling task queue: `observer-engine`

### 6.3 Test Workflow Execution

Use the Temporal CLI to start a test workflow:

```bash
# Install Temporal CLI
brew install temporal

# Connect to Temporal Cloud
temporal workflow start \
  --address your-namespace.tmprl.cloud:7233 \
  --namespace your-namespace.account-id \
  --tls-cert-path client.pem \
  --tls-key-path client-key.pem \
  --task-queue observer-engine \
  --type bootstrapProject \
  --workflow-id test-bootstrap-123 \
  --input '{"projectName": "test", "rootPath": "/tmp/test"}'

# Check status
temporal workflow describe \
  --workflow-id test-bootstrap-123 \
  --address your-namespace.tmprl.cloud:7233 \
  --namespace your-namespace.account-id \
  --tls-cert-path client.pem \
  --tls-key-path client-key.pem
```

## 7. Monitoring

### 7.1 Logs

**Cloud Run:**
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=perceo-temporal-worker" \
  --limit 50 \
  --format json
```

**Kubernetes:**
```bash
kubectl logs -f deployment/perceo-temporal-worker
```

### 7.2 Temporal Cloud Metrics

- **Workflow completion rate**: Temporal Cloud UI → Metrics
- **Activity failures**: Temporal Cloud UI → Workflows → Failed
- **Task queue backlog**: Temporal Cloud UI → Task Queues

### 7.3 Alerts

Set up alerts for:
- Worker disconnection
- High activity failure rate
- Task queue backlog growth

## 8. Scaling

### Cloud Run

Auto-scales between min/max instances configured in workflow:

```yaml
--min-instances 1 \
--max-instances 5 \
```

Increase for higher throughput:

```yaml
--min-instances 3 \
--max-instances 10 \
```

### Kubernetes

Update replica count:

```bash
kubectl scale deployment perceo-temporal-worker --replicas=5
```

Or use HPA:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: perceo-temporal-worker-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: perceo-temporal-worker
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

## 9. Troubleshooting

### Worker Not Connecting

**Check logs:**
```bash
# Look for connection errors
gcloud logging read "resource.type=cloud_run_revision" \
  --limit 10 \
  --format="value(textPayload)"
```

**Common issues:**
- Incorrect `TEMPORAL_ADDRESS`
- Invalid TLS certificates
- Network/firewall blocking port 7233

### Activities Failing

**Check Temporal UI:**
1. Navigate to failed workflow
2. View activity error details
3. Check retry history

**Common causes:**
- API credentials expired
- Network timeouts
- Missing environment variables

### Memory/CPU Issues

**Increase resources in workflow:**

```yaml
--memory 1Gi \
--cpu 2 \
```

## 10. Security Best Practices

- ✅ Use Secret Manager for all credentials
- ✅ Rotate TLS certificates before expiry (Temporal Cloud UI shows expiry date)
- ✅ Use least-privilege service accounts
- ✅ Enable VPC egress controls (production)
- ✅ Monitor failed authentication attempts
- ✅ Use separate namespaces for staging/production

## 11. Cost Optimization

### Cloud Run
- Set `--min-instances 0` for staging (cold start acceptable)
- Use `--cpu-throttling` for non-critical workloads
- Monitor request duration to optimize instance sizing

### Temporal Cloud
- Use task queue rate limiting for burst protection
- Optimize workflow duration to reduce billable time
- Archive completed workflows regularly

## References

- [Temporal Cloud Docs](https://docs.temporal.io/cloud)
- [Cloud Run Docs](https://cloud.google.com/run/docs)
- [Temporal TypeScript SDK](https://typescript.temporal.io)
- [Perceo CLI Deployment](./cli_deployment.md)
