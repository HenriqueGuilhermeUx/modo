. "$PSScriptRoot\common.ps1"

$secret = New-RandomSecret 32
Write-Host "Segredo gerado para DISTRIBUTION_CRON_SECRET." -ForegroundColor Green
Write-Host ""
Write-Host $secret -ForegroundColor White
Write-Host ""
try {
  Set-Clipboard -Value $secret
  Write-Host "O valor também foi copiado para a área de transferência." -ForegroundColor Cyan
} catch {
  Write-Host "Copie manualmente o valor acima." -ForegroundColor Yellow
}
Write-Host "Use exatamente o mesmo valor em:" -ForegroundColor Cyan
Write-Host "1. Render > modo-api > DISTRIBUTION_CRON_SECRET"
Write-Host "2. n8n > credential 'MODO Distribution Cron Secret' > header x-modo-distribution-secret"
Write-Host "Não salve este segredo no GitHub nem envie pelo chat." -ForegroundColor Yellow
