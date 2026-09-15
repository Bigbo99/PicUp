Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Label,
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command
  )

  Write-Host ""
  Write-Host $Label
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")
Set-Location $repo

Write-Host "== Local release check =="
Write-Host "Repo: $repo"

$previousAppImage = $env:APP_IMAGE
$env:APP_IMAGE = "picup-app:local"
$env:WEB_PUBLISH_PORT = "127.0.0.1:3000"
$env:API_PUBLISH_PORT = "127.0.0.1:4400"
$composeFiles = @("-f", "docker-compose.yml", "-f", "docker-compose.local.yml")

try {
  Invoke-Step "[1/5] git status" { git status --short --branch }
  Invoke-Step "[2/5] pnpm typecheck" { pnpm typecheck }
  Invoke-Step "[3/5] docker compose build api" { docker compose @composeFiles build api }
  Invoke-Step "[4/5] docker compose up -d --no-build" { docker compose @composeFiles up -d --no-build }

  Write-Host ""
  Write-Host "[5/5] health checks"

  $apiOk = $false
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $api = Invoke-RestMethod -Uri "http://localhost:4400/api/health" -Method Get -TimeoutSec 10
      if ($api.ok -eq $true) {
        $apiOk = $true
        break
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  if (-not $apiOk) {
    throw "API health check failed at http://localhost:4400/api/health"
  }

  Invoke-Step "[5/5] web head check" { curl.exe -fsSI --max-time 15 "http://localhost:3000" }

  Write-Host ""
  Write-Host "== docker compose ps =="
  docker compose @composeFiles ps

  Write-Host ""
  Write-Host "Local release check passed."
} finally {
  if ($null -eq $previousAppImage) {
    Remove-Item Env:APP_IMAGE -ErrorAction SilentlyContinue
  } else {
    $env:APP_IMAGE = $previousAppImage
  }
}
