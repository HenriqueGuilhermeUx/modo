. "$PSScriptRoot\common.ps1"

param(
  [switch]$Purge
)

$paths = Get-PostizPaths
Stop-CloudflaredIfRunning

if (Test-Path $paths.PostizRepo) {
  if ($Purge) {
    Write-Host "Parando Postiz e removendo volumes locais..." -ForegroundColor Yellow
    Invoke-PostizCompose down -v
  } else {
    Write-Host "Parando Postiz sem apagar dados..." -ForegroundColor Cyan
    Invoke-PostizCompose down
  }
}

Remove-Item $paths.TunnelUrl -Force -ErrorAction SilentlyContinue
Write-Host "Postiz local parado." -ForegroundColor Green
if (-not $Purge) {
  Write-Host "Dados PostgreSQL/Redis/uploads foram preservados nos volumes Docker."
}
