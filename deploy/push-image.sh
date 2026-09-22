#!/usr/bin/env bash
# Push a previously built image with bounded retries and per-layer progress.
set -euo pipefail

image="${1:?Usage: push-image.sh IMAGE}"
attempts="${PUSH_ATTEMPTS:-3}"
limit="${PUSH_TIMEOUT_SECONDS:-360}"
for value in "$attempts" "$limit"; do
  [[ "$value" =~ ^[1-9][0-9]*$ ]] || { echo 'Invalid retry/timeout setting' >&2; exit 2; }
done
docker image inspect "$image" --format 'Local image: {{.Id}}; bytes: {{.Size}}'

for ((attempt=1; attempt<=attempts; attempt++)); do
  echo "[$(date -u +%FT%TZ)] Upload attempt $attempt/$attempts; timeout ${limit}s"
  started=$SECONDS
  if timeout --signal=TERM --kill-after=15s "${limit}s" docker push "$image"; then
    echo "Upload completed in $((SECONDS - started))s"
    exit 0
  else
    status=$?
  fi
  echo "::warning::Upload attempt $attempt failed after $((SECONDS - started))s (exit $status; 124 means timeout)."
  if ((attempt < attempts)); then
    echo 'Retrying in 10s; registry reuses layers already uploaded.'
    sleep 10
  fi
done
echo '::error::Image upload exhausted retries; deployment will not run.'
exit 1
