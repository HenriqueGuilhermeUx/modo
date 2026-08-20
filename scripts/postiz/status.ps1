. "$PSScriptRoot\common.ps1"

$paths = Get-PostizPaths
Write-Host "MODO / Postiz self-hosted" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $paths.PostizRepo)) {
  Write-Host "Compose oficial ainda não foi baixado. Rode bootstrap.ps1." -ForegroundColor Yellow
  exit 1
}

Invoke-PostizCompose ps

$values = Read-EnvFile $paths.EnvFile
$publicUrl = $values["POSTIZ_PUBLIC_URL"]
if (-not $publicUrl) { $publicUrl = "http://localhost:4007" }

Write-Host ""
Write-Host "Origin local: http://localhost:4007"
Write-Host "URL configurada: $publicUrl"
Write-Host "API MODO: $publicUrl/api/public/v1"

try {
  $response = Invoke-WebRequest -Uri "http://localhost:4007" -UseBasicParsing -TimeoutSec 8
  Write-Host "Local HTTP: $($response.StatusCode)" -ForegroundColor Green
} catch {
  Write-Host "Local HTTP: indisponível" -ForegroundColor Red
}

if ($publicUrl -ne "http://localhost:4007") {
  try {
    $response = Invoke-WebRequest -Uri $publicUrl -UseBasicParsing -TimeoutSec 10
    Write-Host "Tunnel HTTP: $($response.StatusCode)" -ForegroundColor Green
  } catch {
    Write-Host "Tunnel HTTP: indisponível" -ForegroundColor Red
  }
}
