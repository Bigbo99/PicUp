Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")
Set-Location $repo

$server = "root@YOUR_SERVER_IP"
$key = Join-Path $repo "picup_actions_server_new"
$port = 22

Write-Host "== Server deploy check =="

$remoteCommand = @"
cd YOUR_SERVER_APP_DIR
echo '== commit =='
git rev-parse --short HEAD
echo '== app image =='
grep '^APP_IMAGE=' .env || true
echo '== compose =='
docker compose ps
echo '== api health =='
curl -fsS http://127.0.0.1:4000/api/health
"@

& ssh `
  -i $key `
  -p $port `
  -o ConnectTimeout=10 `
  -o IdentitiesOnly=yes `
  -o BatchMode=yes `
  $server `
  $remoteCommand

Write-Host ""
Write-Host "Server deploy check completed."
