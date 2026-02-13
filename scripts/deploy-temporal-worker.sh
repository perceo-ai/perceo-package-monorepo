#!/usr/bin/env bash
set -euo pipefail

# Load environment variables from .env.deploy if it exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env.deploy"
if [[ -f "${ENV_FILE}" ]]; then
  echo "Loading environment variables from ${ENV_FILE}..."
  set -a  # Automatically export all variables
  source "${ENV_FILE}"
  set +a  # Disable automatic export
fi

# Backwards-compatible mapping: if PERCEO_TEMPORAL_ADDRESS is not set,
# but PERCEO_TEMPORAL_REGIONAL_ENDPOINT is, use that as the address.
# The worker code reads PERCEO_TEMPORAL_ADDRESS and defaults to localhost:7233
# when it's missing, which causes connection errors in Cloud Run.
if [[ -z "${PERCEO_TEMPORAL_ADDRESS:-}" && -n "${PERCEO_TEMPORAL_REGIONAL_ENDPOINT:-}" ]]; then
  export PERCEO_TEMPORAL_ADDRESS="${PERCEO_TEMPORAL_REGIONAL_ENDPOINT}"
fi

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
#   GCP_REGION               - Cloud Run region (default: us-west1)
#   ARTIFACT_REGISTRY_REPO   - Artifact Registry repository name (default: docker-repo)
#   BUILD_LOCALLY            - Set to "1" to build locally instead of using pre-built image
#   SKIP_PUSH                - Set to "1" to skip docker push (e.g. when using local deploy)
#
# For Temporal Cloud connection, set these when deploying (via --set-env-vars or Secret Manager):
#   PERCEO_TEMPORAL_ADDRESS, PERCEO_TEMPORAL_NAMESPACE,
#   PERCEO_TEMPORAL_TLS_CERT_PATH, PERCEO_TEMPORAL_TLS_KEY_PATH
#
# NOTE: By default, this script expects a pre-built image from GitHub Actions.
#       To build locally, set BUILD_LOCALLY=1 (requires Docker).
#
#       If the image is from an external registry (ghcr.io, docker.io, etc.),
#       the script will automatically copy it to Artifact Registry since Cloud Run
#       only supports GCR and Artifact Registry images.

GCP_REGION="${GCP_REGION:-us-west1}"
ARTIFACT_REGISTRY_REPO="${ARTIFACT_REGISTRY_REPO:-docker-repo}"

if [[ -z "${IMAGE:-}" ]]; then
  echo "Error: IMAGE env var is required (e.g. ghcr.io/org/repo/temporal-worker:latest)"
  echo ""
  echo "For GitHub Container Registry, use:"
  echo "  export IMAGE=ghcr.io/YOUR_USERNAME/YOUR_REPO/temporal-worker:latest"
  echo ""
  echo "Note: Cloud Run doesn't support ghcr.io directly. The script will automatically"
  echo "      copy the image to Artifact Registry if needed."
  exit 1
fi

if [[ -z "${GCP_PROJECT:-}" ]]; then
  echo "Error: GCP_PROJECT env var is required"
  exit 1
fi

# Check if image is from unsupported registry (ghcr.io, docker.io, etc.)
# Cloud Run only supports gcr.io and docker.pkg.dev (Artifact Registry)
NEEDS_COPY=false
if [[ "${IMAGE}" =~ ^ghcr\.io/ ]] || [[ "${IMAGE}" =~ ^docker\.io/ ]] || [[ "${IMAGE}" =~ ^[^/]+\.io/ ]]; then
  # Check if it's already a supported registry
  if [[ ! "${IMAGE}" =~ ^[^/]*\.gcr\.io/ ]] && [[ ! "${IMAGE}" =~ ^[^/]*docker\.pkg\.dev/ ]]; then
    NEEDS_COPY=true
  fi
fi

# If image needs to be copied to Artifact Registry, do it
if [[ "${NEEDS_COPY}" == "true" ]]; then
  if ! command -v docker &> /dev/null; then
    echo "Error: Docker is required to copy images from external registries."
    echo "       Install Docker or use an image from gcr.io or docker.pkg.dev"
    exit 1
  fi

  echo "Image ${IMAGE} is from an external registry."
  echo "Cloud Run requires images to be in GCR or Artifact Registry."
  echo "Copying image to Artifact Registry..."
  
  # Check if Artifact Registry repository exists, create if not
  echo "Checking if Artifact Registry repository exists..."
  if ! gcloud artifacts repositories describe "${ARTIFACT_REGISTRY_REPO}" \
    --location="${GCP_REGION}" \
    --project="${GCP_PROJECT}" &>/dev/null; then
    echo "Creating Artifact Registry repository: ${ARTIFACT_REGISTRY_REPO}"
    gcloud artifacts repositories create "${ARTIFACT_REGISTRY_REPO}" \
      --repository-format=docker \
      --location="${GCP_REGION}" \
      --project="${GCP_PROJECT}" \
      --description="Docker repository for Perceo Temporal Worker"
  else
    echo "Artifact Registry repository already exists."
  fi
  
  # Extract image name and tag
  # Handle both formats: repo/image:tag and repo/image@digest
  if [[ "${IMAGE}" =~ :([^@]+) ]]; then
    IMAGE_TAG="${BASH_REMATCH[1]}"
  else
    IMAGE_TAG="latest"
  fi
  IMAGE_NAME=$(basename "${IMAGE%%:*}" | cut -d@ -f1)
  
  # Construct Artifact Registry image path
  AR_IMAGE="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/${ARTIFACT_REGISTRY_REPO}/${IMAGE_NAME}:${IMAGE_TAG}"
  
  echo "Pulling ${IMAGE}..."
  docker pull "${IMAGE}"
  
  echo "Tagging as ${AR_IMAGE}..."
  docker tag "${IMAGE}" "${AR_IMAGE}"
  
  echo "Configuring Docker for Artifact Registry..."
  gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet
  
  echo "Pushing to Artifact Registry..."
  docker push "${AR_IMAGE}"
  
  # Update IMAGE to use Artifact Registry version
  IMAGE="${AR_IMAGE}"
  echo "Using Artifact Registry image: ${IMAGE}"
fi

# Build locally only if BUILD_LOCALLY is set
if [[ "${BUILD_LOCALLY:-}" == "1" ]]; then
  if ! command -v docker &> /dev/null; then
    echo "Error: Docker is required for local builds. Install Docker or use pre-built images."
    exit 1
  fi
  
  echo "Building Temporal worker Docker image locally..."
  docker build --network host -f apps/temporal-worker/Dockerfile -t "${IMAGE}" .

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
  --allow-unauthenticated \
  --set-env-vars PERCEO_TEMPORAL_ADDRESS="${PERCEO_TEMPORAL_ADDRESS}" \
  --set-env-vars PERCEO_TEMPORAL_API_KEY="${PERCEO_TEMPORAL_API_KEY}" \
  --set-env-vars PERCEO_TEMPORAL_NAMESPACE="${PERCEO_TEMPORAL_NAMESPACE}" \
  --set-env-vars PERCEO_TEMPORAL_ENABLED="${PERCEO_TEMPORAL_ENABLED}" \
  --set-env-vars PERCEO_TEMPORAL_TASK_QUEUE="${PERCEO_TEMPORAL_TASK_QUEUE}" \
  --set-env-vars PERCEO_TEMPORAL_REGIONAL_ENDPOINT="${PERCEO_TEMPORAL_REGIONAL_ENDPOINT}" 

echo "Deployment complete. Worker will connect to Temporal Cloud using PERCEO_* env vars."
echo "Ensure PERCEO_TEMPORAL_ADDRESS, PERCEO_TEMPORAL_NAMESPACE, and TLS certs are configured."
echo "See docs/temporal_worker_deployment.md for details."
