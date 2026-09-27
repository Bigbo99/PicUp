#!/usr/bin/env bash
# Exercise the real deployment script with fake Docker/health commands only.
set -Eeuo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/picup-deploy-test.XXXXXX")"
cleanup() {
  case "$test_root" in
    "${TMPDIR:-/tmp}"/picup-deploy-test.*) rm -rf -- "$test_root" ;;
    *) echo 'Refusing to remove an unexpected test directory' >&2; exit 1 ;;
  esac
}
trap cleanup EXIT
mkdir -p "$test_root/deploy" "$test_root/bin"
sed 's/\r$//' "$SOURCE_DIR/deploy.sh" > "$test_root/deploy/deploy.sh"

cat > "$test_root/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
printf '%s %s\n' "$APP_IMAGE" "$*" >> "$MOCK_DOCKER_LOG"
if [[ "$*" == 'compose ps --status running --services' ]]; then printf 'worker\n'; fi
MOCK
cat > "$test_root/bin/curl" <<'MOCK'
#!/usr/bin/env bash
[[ "${MOCK_HEALTH_OK:-1}" == 1 ]]
MOCK
for name in nginx find sleep; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$test_root/bin/$name"
done
chmod +x "$test_root/bin/"*
export PATH="$test_root/bin:$PATH"
export MOCK_DOCKER_LOG="$test_root/docker.log"
export APP_IMAGE='picup-app:sha-test123' RELEASE_TAG='sha-test123'
export ACR_REGISTRY='' ACR_USERNAME='' ACR_PASSWORD='' ACR_IMAGE=''

printf 'APP_ENV=production\nAPP_IMAGE=old:first\nUNCHANGED=value\nexport APP_IMAGE=old:last\n' > "$test_root/.env"
bash "$test_root/deploy/deploy.sh" > "$test_root/success.log" 2>&1
[[ "$(grep -c '^APP_IMAGE=' "$test_root/.env")" == 1 ]]
grep -qx 'APP_IMAGE=picup-app:sha-test123' "$test_root/.env"
grep -qx 'UNCHANGED=value' "$test_root/.env"
! grep -q '^export APP_IMAGE=' "$test_root/.env"
grep -q 'picup-app:sha-test123 compose up' "$MOCK_DOCKER_LOG"
echo 'PASS: successful release replaces duplicate image settings and preserves other values'

printf 'APP_ENV=production\nUNCHANGED=value\n' > "$test_root/.env"
bash "$test_root/deploy/deploy.sh" > "$test_root/missing.log" 2>&1
grep -qx 'APP_IMAGE=picup-app:sha-test123' "$test_root/.env"
echo 'PASS: successful release appends a missing image setting'

printf 'APP_ENV=production\nAPP_IMAGE=old:healthy\n' > "$test_root/.env"
cp "$test_root/.env" "$test_root/expected.env"
if MOCK_HEALTH_OK=0 bash "$test_root/deploy/deploy.sh" > "$test_root/failed.log" 2>&1; then
  echo 'FAIL: unhealthy deployment succeeded' >&2
  exit 1
fi
cmp "$test_root/expected.env" "$test_root/.env"
echo 'PASS: failed health checks preserve the previous image setting'
