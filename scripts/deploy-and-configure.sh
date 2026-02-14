#!/bin/bash
set -e

echo "🚀 Deploying Perceo Worker and Configuring CLI..."
echo ""

# Deploy worker
echo "📦 Step 1: Deploying worker to Cloud Run..."
pnpm worker:deploy

echo ""
echo "✅ Step 2: Getting Cloud Run URL..."
WORKER_URL=$(gcloud run services describe perceo-temporal-worker \
  --region us-west1 \
  --format 'value(status.url)' 2>/dev/null)

if [ -z "$WORKER_URL" ]; then
  echo "❌ Failed to get Cloud Run URL"
  echo "Please run manually:"
  echo "  gcloud run services describe perceo-temporal-worker --region us-west1 --format 'value(status.url)'"
  exit 1
fi

echo "   Worker URL: $WORKER_URL"
echo ""

# Update .env file
echo "✅ Step 3: Updating .env file..."
if grep -q "PERCEO_WORKER_API_URL=" .env 2>/dev/null; then
  # Replace existing
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|PERCEO_WORKER_API_URL=.*|PERCEO_WORKER_API_URL=$WORKER_URL|g" .env
  else
    sed -i "s|PERCEO_WORKER_API_URL=.*|PERCEO_WORKER_API_URL=$WORKER_URL|g" .env
  fi
  echo "   Updated PERCEO_WORKER_API_URL in .env"
else
  # Add new
  echo "" >> .env
  echo "# Worker API URL (auto-configured)" >> .env
  echo "PERCEO_WORKER_API_URL=$WORKER_URL" >> .env
  echo "   Added PERCEO_WORKER_API_URL to .env"
fi

echo ""
echo "✅ Step 4: Testing worker health..."
HEALTH_CHECK=$(curl -s "$WORKER_URL/health" 2>/dev/null || echo "failed")

if echo "$HEALTH_CHECK" | grep -q "ok"; then
  echo "   ✓ Worker is healthy!"
else
  echo "   ⚠️  Warning: Health check failed, but this is normal right after deployment"
  echo "   Worker may still be starting up. Wait 10-15 seconds and try again."
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ Deployment Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Worker URL: $WORKER_URL"
echo ""
echo "🧪 Test your CLI:"
echo "   perceo init"
echo ""
echo "📊 View logs:"
echo "   gcloud run logs read perceo-temporal-worker --region us-west1 --limit 50"
echo ""
echo "🔍 Check worker status:"
echo "   curl $WORKER_URL/health"
echo ""
