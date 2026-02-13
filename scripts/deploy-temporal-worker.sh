#!/usr/bin/env bash
set -euo pipefail

# Deploy Perceo Temporal Worker to Temporal Cloud (via Cloud Run)
#
# The worker runs on Cloud Run and connects to Temporal Cloud. Prerequisites:
#   - gcloud CLI installed and authenticated
#   - Temporal Cloud mTLS certificates (see docs/temporal_worker_deployment.md)
#
# Required env vars:
#   IMAGE                    - Full image URL (e.g. ghcr.io/org/repo/temporal-worker:latest)
#   GCP_PROJECT              - Google Cloud project ID
#
# Optional env vars:
#   GCP_REGION               - Cloud Run region (default: us-central1)
#   BUILD_LOCALLY            - Set to "1" to build locally instead of using pre-built image
#   SKIP_PUSH                - Set to "1" to skip docker push (e.g. when using local deploy)
#
# For Temporal Cloud connection, set these when deploying (via --set-env-vars or Secret Manager):
#   PERCEO_TEMPORAL_ADDRESS, PERCEO_TEMPORAL_NAMESPACE,
#   PERCEO_TEMPORAL_TLS_CERT_PATH, PERCEO_TEMPORAL_TLS_KEY_PATH
#
# NOTE: By default, this script expects a pre-built image from GitHub Actions.
#       To build locally, set BUILD_LOCALLY=1 (requires Docker).

GCP_REGION="${GCP_REGION:-us-central1}"

if [[ -z "${IMAGE:-}" ]]; then
  echo "Error: IMAGE env var is required (e.g. ghcr.io/org/repo/temporal-worker:latest)"
  echo ""
  echo "For GitHub Container Registry, use:"
  echo "  export IMAGE=ghcr.io/YOUR_USERNAME/YOUR_REPO/temporal-worker:latest"
  exit 1
fi

if [[ -z "${GCP_PROJECT:-}" ]]; then
  echo "Error: GCP_PROJECT env var is required"
  exit 1
fi

# Build locally only if BUILD_LOCALLY is set
if [[ "${BUILD_LOCALLY:-}" == "1" ]]; then
  if ! command -v docker &> /dev/null; then
    echo "Error: Docker is required for local builds. Install Docker or use pre-built images."
    exit 1
  fi
  
  echo "Building Temporal worker Docker image locally..."
  docker build -f apps/temporal-worker/Dockerfile -t "${IMAGE}" .

  if [[ "${SKIP_PUSH:-}" != "1" ]]; then
    echo "Pushing image to registry..."
    docker push "${IMAGE}"
  fi
else
  echo "Using pre-built image: ${IMAGE}"
  echo ""
  echo "To build the image remotely:"
  echo "  1. Push your changes to GitHub"
  echo "  2. Go to Actions → 'Build Temporal Worker' → Run workflow"
  echo "  3. Or it will build automatically on push to main"
  echo ""
  echo "To build locally instead, set BUILD_LOCALLY=1"
fi

echo "Deploying to Cloud Run (region: ${GCP_REGION})..."
gcloud run deploy perceo-temporal-worker \
  --image "${IMAGE}" \
  --project "${GCP_PROJECT}" \
  --region "${GCP_REGION}" \
  --platform managed \
  --min-instances 1 \
  --max-instances 10 \
  --memory 512Mi \
  --cpu 1 \
  --allow-unauthenticated

echo "Deployment complete. Worker will connect to Temporal Cloud using PERCEO_* env vars."
echo "Ensure PERCEO_TEMPORAL_ADDRESS, PERCEO_TEMPORAL_NAMESPACE, and TLS certs are configured."
echo "See docs/temporal_worker_deployment.md for details."
