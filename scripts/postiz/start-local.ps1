. "$PSScriptRoot\common.ps1"

Assert-Command "docker" "Instale/inicie o Docker Desktop."
$paths = Get-PostizPaths
if (-not (Test-Path $paths.EnvFile)) { Ensure-PostizEnv | Out-Null }
Set-EnvValue $paths.EnvFile "POSTIZ_PUBLIC_URL" "http://localhost:4007"

Write-Host "Subindo Postiz + PostgreSQL + Redis + Temporal..." -ForegroundColor Cyan
Invoke-PostizCompose up -d

Write-Host "Aguardando http://localhost:4007 ..." -ForegroundColor Cyan
if (-not (Wait-Http "http://localhost:4007" 240)) {
  Write-Host "Postiz não respondeu dentro do prazo. Últimos containers:" -ForegroundColor Yellow
  Invoke-PostizCompose ps
  throw "Postiz não ficou saudável em http://localhost:4007."
}

Write-Host ""
Write-Host "Postiz local está funcionando." -ForegroundColor Green
Write-Host "UI: http://localhost:4007"
Write-Host "API self-hosted: http://localhost:4007/api/public/v1"
Write-Host "Temporal UI: http://localhost:8080"
Write-Host ""
Write-Host "Para testar OAuth com Meta/Instagram pela internet, rode:"
Write-Host "powershell -ExecutionPolicy Bypass -File scripts/postiz/start-tunnel.ps1" -ForegroundColor White
