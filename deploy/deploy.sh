#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

persist_app_image() {
  local temporary
  temporary="$(mktemp "$PROJECT_DIR/.env.release.XXXXXX")"
  if ! awk -v value="$APP_IMAGE" '
    BEGIN { found=0 }
    /^[[:space:]]*(export[[:space:]]+)?APP_IMAGE[[:space:]]*=/ {
      if (!found) print "APP_IMAGE=" value
      found=1
      next
    }
    { print }
    END { if (!found) print "APP_IMAGE=" value }
  ' .env > "$temporary"; then
    rm -f -- "$temporary"
    return 1
  fi
  chmod --reference=.env "$temporary"
  mv -f -- "$temporary" .env
}

wait_for_url() {
  local label="$1" url="$2" retries="${3:-30}"
  for ((i=1; i<=retries; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then echo "OK: $label healthy"; return 0; fi
    sleep 2
  done
  echo "ERROR: $label health check timed out: $url" >&2
  return 1
}

failure_context() {
  local status=$?
  trap - ERR
  echo "ERROR: deployment failed (exit $status)"
  docker compose ps -a || true
  docker compose logs --tail=120 migrate api web worker || true
  exit "$status"
}
trap failure_context ERR

command -v docker >/dev/null || { echo 'ERROR: Docker not found'; exit 1; }
docker compose version >/dev/null || { echo 'ERROR: Docker Compose V2 not found'; exit 1; }
[ -f .env ] || { echo 'ERROR: .env not found'; exit 1; }

RELEASE_TAG="${RELEASE_TAG:-sha-$(git rev-parse --short=7 HEAD)}"
export APP_IMAGE="${APP_IMAGE:-picup-app:${RELEASE_TAG}}"
echo "Building local release image: $APP_IMAGE"
mkdir -p storage/inputs storage/outputs

# Build only the application image. Postgres and Redis are never rebuilt.
docker compose build api
docker image inspect "$APP_IMAGE" >/dev/null

docker compose up -d --no-recreate postgres redis
docker compose run --rm migrate
docker compose up -d --no-build --no-deps api
wait_for_url 'API readiness' 'http://127.0.0.1:4000/api/ready'
docker compose up -d --no-build --no-deps --force-recreate worker web
wait_for_url 'Worker readiness' 'http://127.0.0.1:4000/api/ready/worker'
wait_for_url 'Web' 'http://127.0.0.1:3000'
docker compose ps --status running --services | grep -qx worker

PAGE_CACHE_DIR="/www/wwwroot/picup.ai-mendao.com/proxy_cache_dir"
if [ -d "$PAGE_CACHE_DIR" ]; then find "$PAGE_CACHE_DIR" -mindepth 1 -delete; fi
if command -v nginx >/dev/null 2>&1; then nginx -t && nginx -s reload; fi

# Subsequent Compose commands must select the release that passed health checks.
persist_app_image
echo "OK: release persisted: $APP_IMAGE"

# Keep tagged releases available for rollback and remove only dangling layers.
docker image prune -f >/dev/null

# ACR is a backup destination. Its outage must not take down the release.
if [[ -n "${ACR_REGISTRY:-}" && -n "${ACR_USERNAME:-}" && -n "${ACR_PASSWORD:-}" && -n "${ACR_IMAGE:-}" ]]; then
  backup_image="${ACR_IMAGE}:${RELEASE_TAG}"
  if echo "$ACR_PASSWORD" | docker login "$ACR_REGISTRY" --username "$ACR_USERNAME" --password-stdin >/dev/null && \
     docker tag "$APP_IMAGE" "$backup_image" && \
     timeout --signal=TERM --kill-after=15s 360s docker push "$backup_image"; then
    echo "OK: ACR backup pushed: $backup_image"
  else
    echo 'WARNING: ACR backup failed or timed out; local deployment remains active.'
  fi
else
  echo 'WARNING: ACR backup credentials not supplied; skipped.'
fi

echo 'Deployment completed.'
docker compose ps
