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

Invoke-Step "[1/5] git status" { git status --short --branch }
Invoke-Step "[2/5] pnpm typecheck" { pnpm typecheck }
Invoke-Step "[3/5] pnpm build" { pnpm build }
Invoke-Step "[4/5] docker compose up -d --build" { docker compose up -d --build }

Write-Host ""
Write-Host "[5/5] health checks"

$apiOk = $false
for ($i = 0; $i -lt 15; $i++) {
  try {
    $api = Invoke-RestMethod -Uri "http://localhost:4000/api/health" -Method Get -TimeoutSec 10
    if ($api.ok -eq $true) {
      $apiOk = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 2
  }
}

if (-not $apiOk) {
  throw "API health check failed at http://localhost:4000/api/health"
}

Invoke-Step "[5/5] web head check" { curl.exe -fsSI --max-time 15 "http://localhost:3000" }

Write-Host ""
Write-Host "== docker compose ps =="
docker compose ps

Write-Host ""
Write-Host "Local release check passed."
