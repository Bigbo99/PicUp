#!/bin/bash
# PicUp production deploy script (pull prebuilt image, no server build)

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

read_env_value() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); value=$0 } END { print value }' .env | tr -d '\r'
}

persist_env_value() {
  local key="$1"
  local value="$2"
  local temp_file
  temp_file="$(mktemp)"

  awk -v key="$key" -v value="$value" '
    BEGIN { found=0 }
    $0 ~ "^" key "=" {
      if (!found) print key "=" value
      found=1
      next
    }
    { print }
    END { if (!found) print key "=" value }
  ' .env > "$temp_file"

  cat "$temp_file" > .env
  rm -f "$temp_file"
}

wait_for_url() {
  local label="$1"
  local url="$2"
  local max_retries="${3:-30}"
  local retry=0

  until curl -fsS "$url" >/dev/null 2>&1; do
    retry=$((retry + 1))
    if [ "$retry" -ge "$max_retries" ]; then
      echo "ERROR: $label health check timed out: $url"
      return 1
    fi
    sleep 2
  done

  echo "OK: $label healthy"
}

show_failure_context() {
  local status=$?
  trap - ERR
  echo ""
  echo "ERROR: deployment failed (exit $status)"
  docker compose ps -a || true
  docker compose logs --tail=120 migrate api web worker || true
  exit "$status"
}

trap show_failure_context ERR

echo "=========================================="
echo "  PicUp Deploy (Pull Image Mode)"
echo "=========================================="

echo ""
echo "[1/8] Check environment..."
command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker not found"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERROR: Docker Compose V2 not found"; exit 1; }
[ -f .env ] || { echo "ERROR: .env not found"; exit 1; }

APP_IMAGE="${APP_IMAGE:-}"
ACR_REGISTRY="${ACR_REGISTRY:-}"
ACR_USERNAME="${ACR_USERNAME:-}"
ACR_PASSWORD="${ACR_PASSWORD:-}"

[ -n "$APP_IMAGE" ] || { echo "ERROR: APP_IMAGE is empty"; exit 1; }
[ -n "$ACR_REGISTRY" ] || { echo "ERROR: ACR_REGISTRY is empty"; exit 1; }
[ -n "$ACR_USERNAME" ] || { echo "ERROR: ACR_USERNAME is empty"; exit 1; }
[ -n "$ACR_PASSWORD" ] || { echo "ERROR: ACR_PASSWORD is empty"; exit 1; }
export APP_IMAGE
echo "OK: APP_IMAGE=$APP_IMAGE"

echo ""
echo "[2/8] Validate production settings..."
NEXT_PUBLIC_API_BASE_URL="$(read_env_value NEXT_PUBLIC_API_BASE_URL)"
APP_ENV="$(read_env_value APP_ENV)"
[ -z "$NEXT_PUBLIC_API_BASE_URL" ] || {
  echo "ERROR: NEXT_PUBLIC_API_BASE_URL must be empty in production reverse-proxy mode"
  exit 1
}
[ "$APP_ENV" = "production" ] || echo "WARN: APP_ENV=${APP_ENV:-unset}, production is recommended"

echo ""
echo "[3/8] Prepare storage directories..."
mkdir -p storage/inputs storage/outputs

echo ""
echo "[4/8] Pull immutable application image..."
echo "$ACR_PASSWORD" | docker login "$ACR_REGISTRY" --username "$ACR_USERNAME" --password-stdin >/dev/null
docker pull "$APP_IMAGE"

echo ""
echo "[5/8] Ensure infrastructure is running..."
docker compose up -d --no-recreate postgres redis

echo ""
echo "[6/8] Apply database migrations..."
docker compose run --rm migrate

echo ""
echo "[7/8] Update application services..."
docker compose up -d --no-build --no-deps api
wait_for_url "API" "http://127.0.0.1:4000/api/health"
docker compose up -d --no-build --no-deps --force-recreate worker web
wait_for_url "Web" "http://127.0.0.1:3000"
docker compose ps --status running --services | grep -qx worker || {
  echo "ERROR: Worker is not running"
  exit 1
}
echo "OK: Worker running"

PAGE_CACHE_DIR="/www/wwwroot/picup.ai-mendao.com/proxy_cache_dir"
if [ -d "$PAGE_CACHE_DIR" ]; then
  find "$PAGE_CACHE_DIR" -mindepth 1 -delete
  echo "OK: cleared stale page cache: $PAGE_CACHE_DIR"
fi
if command -v nginx >/dev/null 2>&1; then
  nginx -t
  nginx -s reload
  echo "OK: Nginx reloaded"
fi

echo ""
echo "[8/8] Persist release and clean dangling data..."
persist_env_value APP_IMAGE "$APP_IMAGE"
docker image prune -f >/dev/null
echo "OK: release persisted"

echo ""
echo "=========================================="
echo "  Deploy Completed"
echo "=========================================="
docker compose ps
