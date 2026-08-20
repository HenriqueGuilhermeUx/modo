. "$PSScriptRoot\common.ps1"

Assert-Command "docker" "Instale/inicie o Docker Desktop."
Assert-Command "cloudflared" "No Windows rode: winget install --id Cloudflare.cloudflared"

$paths = Get-PostizPaths
if (-not (Test-Path $paths.EnvFile)) { Ensure-PostizEnv | Out-Null }

# Garante que o origin local esteja disponível antes de abrir o tunnel.
Set-EnvValue $paths.EnvFile "POSTIZ_PUBLIC_URL" "http://localhost:4007"
Invoke-PostizCompose up -d
if (-not (Wait-Http "http://localhost:4007" 240)) {
  throw "Postiz local não está respondendo. Rode start-local.ps1 e confira o Docker Desktop."
}

Stop-CloudflaredIfRunning
New-Item -ItemType Directory -Force -Path $paths.TunnelDir | Out-Null
Remove-Item $paths.TunnelStdout,$paths.TunnelStderr,$paths.TunnelUrl -Force -ErrorAction SilentlyContinue

Write-Host "Abrindo Cloudflare Quick Tunnel gratuito..." -ForegroundColor Cyan
$cloudflared = (Get-Command cloudflared).Source
$process = Start-Process -FilePath $cloudflared `
  -ArgumentList @("tunnel", "--no-autoupdate", "--url", "http://localhost:4007") `
  -PassThru `
  -WindowStyle Hidden `
  -RedirectStandardOutput $paths.TunnelStdout `
  -RedirectStandardError $paths.TunnelStderr
$process.Id | Set-Content $paths.TunnelPid -Encoding ascii

$deadline = (Get-Date).AddSeconds(90)
$publicUrl = $null
while ((Get-Date) -lt $deadline -and -not $publicUrl) {
  Start-Sleep -Seconds 2
  $text = ""
  if (Test-Path $paths.TunnelStdout) { $text += (Get-Content $paths.TunnelStdout -Raw -ErrorAction SilentlyContinue) }
  if (Test-Path $paths.TunnelStderr) { $text += "`n" + (Get-Content $paths.TunnelStderr -Raw -ErrorAction SilentlyContinue) }
  $match = [Regex]::Match($text, "https://[a-zA-Z0-9-]+\.trycloudflare\.com")
  if ($match.Success) { $publicUrl = $match.Value.TrimEnd('/') }
}

if (-not $publicUrl) {
  Stop-CloudflaredIfRunning
  throw "O Cloudflare não retornou a URL pública. Veja $($paths.TunnelStderr)."
}

$publicUrl | Set-Content $paths.TunnelUrl -Encoding ascii
Set-EnvValue $paths.EnvFile "POSTIZ_PUBLIC_URL" $publicUrl

Write-Host "Recriando somente o Postiz com URL pública correta para OAuth..." -ForegroundColor Cyan
Invoke-PostizCompose up -d --force-recreate postiz

if (-not (Wait-Http $publicUrl 180)) {
  throw "O tunnel foi criado ($publicUrl), mas o Postiz ainda não respondeu pela URL pública."
}

Write-Host ""
Write-Host "POSTIZ SELF-HOSTED PÚBLICO PARA TESTE" -ForegroundColor Green
Write-Host "UI: $publicUrl"
Write-Host "API para a MODO: $publicUrl/api/public/v1"
Write-Host ""
Write-Host "Redirect URIs para Meta Developers:" -ForegroundColor Cyan
Write-Host "Facebook:              $publicUrl/integrations/social/facebook"
Write-Host "Instagram via Facebook: $publicUrl/integrations/social/instagram"
Write-Host "Instagram standalone:   $publicUrl/integrations/social/instagram-standalone"
Write-Host ""
Write-Host "No Render/mode-api, depois de gerar a API Key dentro deste Postiz, use:" -ForegroundColor Cyan
Write-Host "POSTIZ_BASE_URL=$publicUrl/api/public/v1"
Write-Host "POSTIZ_API_KEY=<cole diretamente no Render; não coloque no GitHub/chat>"
Write-Host ""
Write-Host "ATENÇÃO: trycloudflare.com é temporário. Se reiniciar o tunnel, atualize os Redirect URIs da Meta e POSTIZ_BASE_URL no Render." -ForegroundColor Yellow
