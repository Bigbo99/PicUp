#!/bin/bash
# PicUp production deploy script (pull prebuilt image, no local build)
# Usage:
#   APP_IMAGE=crpi-xxxx.cn-hangzhou.personal.cr.aliyuncs.com/namespace/picup:latest ACR_REGISTRY=crpi-xxxx.cn-hangzhou.personal.cr.aliyuncs.com ACR_USERNAME=your_user ACR_PASSWORD=your_password bash deploy/deploy.sh
# or:
#   export APP_IMAGE=crpi-xxxx.cn-hangzhou.personal.cr.aliyuncs.com/namespace/picup:sha-xxxxxxx
#   export ACR_REGISTRY=crpi-xxxx.cn-hangzhou.personal.cr.aliyuncs.com
#   export ACR_USERNAME=your_user
#   export ACR_PASSWORD=your_password
#   bash deploy/deploy.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "=========================================="
echo "  PicUp Deploy (Pull Image Mode)"
echo "=========================================="

echo ""
echo "[1/7] Check environment..."
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker not found"
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: Docker Compose V2 not found"
  exit 1
fi
if [ ! -f .env ]; then
  echo "ERROR: .env not found"
  echo "Hint: cp .env.production.example .env"
  exit 1
fi

if [ -z "${APP_IMAGE:-}" ]; then
  echo "ERROR: APP_IMAGE is empty"
  echo "Example: APP_IMAGE=crpi-xxxx.cn-hangzhou.personal.cr.aliyuncs.com/namespace/picup:latest bash deploy/deploy.sh"
  exit 1
fi
if [ -z "${ACR_REGISTRY:-}" ] || [ -z "${ACR_USERNAME:-}" ] || [ -z "${ACR_PASSWORD:-}" ]; then
  echo "ERROR: ACR_REGISTRY / ACR_USERNAME / ACR_PASSWORD must be set for private ACR pulls"
  exit 1
fi
echo "OK: APP_IMAGE=$APP_IMAGE"

echo ""
echo "[2/7] Validate .env key settings..."
set +u
source <(grep -v '^#' .env | grep '=')
set -u

if [ "${NEXT_PUBLIC_API_BASE_URL:-}" != "" ]; then
  echo "ERROR: NEXT_PUBLIC_API_BASE_URL must be empty in production reverse-proxy mode"
  exit 1
fi
if [ "${APP_ENV:-}" != "production" ]; then
  echo "WARN: APP_ENV=${APP_ENV:-unset}, production is recommended"
fi

echo ""
echo "[3/7] Prepare storage directories..."
mkdir -p storage/inputs storage/outputs

echo ""
echo "[4/7] Pull prebuilt image..."
echo "$ACR_PASSWORD" | docker login "$ACR_REGISTRY" --username "$ACR_USERNAME" --password-stdin >/dev/null
docker compose pull migrate api web worker

echo ""
echo "[5/7] Restart services (no build)..."
docker compose up -d --no-build --force-recreate

echo ""
echo "[6/7] Health check..."
MAX_RETRIES=30
RETRY=0
until curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1; do
  RETRY=$((RETRY + 1))
  if [ "$RETRY" -ge "$MAX_RETRIES" ]; then
    echo "ERROR: API health check timed out"
    docker compose logs --tail=120 api
    exit 1
  fi
  sleep 2
done
echo "OK: API healthy"

echo ""
echo "[7/7] Cleanup unused docker data..."
docker image prune -f >/dev/null
docker builder prune -f --filter 'until=24h' >/dev/null
echo "OK: cleanup complete"

echo ""
echo "=========================================="
echo "  Deploy Completed"
echo "=========================================="
docker compose ps
