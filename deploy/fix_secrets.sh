#!/bin/bash
set -euo pipefail
cd YOUR_SERVER_APP_DIR

echo "=== Generating secrets ==="
JWT_VAL=$(openssl rand -base64 32)
COOKIE_VAL=$(openssl rand -base64 32)
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_VAL}|" .env
sed -i "s|^COOKIE_SECRET=.*|COOKIE_SECRET=${COOKIE_VAL}|" .env
echo "Secrets generated."

echo ""
echo "=== Final .env key values ==="
grep -E '^(APP_ENV|APP_IMAGE|NEXT_PUBLIC_API_BASE_URL|WEB_PUBLIC_URL|API_PUBLIC_URL|MEDIA_PUBLIC_BASE_URL|WEB_PUBLISH_PORT|API_PUBLISH_PORT|JWT_SECRET|COOKIE_SECRET|PROVIDER_MOCK_ENABLED)=' .env
