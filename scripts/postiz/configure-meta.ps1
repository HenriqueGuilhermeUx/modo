. "$PSScriptRoot\common.ps1"

$paths = Get-PostizPaths
if (-not (Test-Path $paths.EnvFile)) { Ensure-PostizEnv | Out-Null }

$appId = Read-Host "Meta App ID (Facebook App ID)"
if (-not $appId.Trim()) { throw "Meta App ID é obrigatório." }
$secureSecret = Read-Host "Meta App Secret (não será exibido)" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
try {
  $appSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
if (-not $appSecret.Trim()) { throw "Meta App Secret é obrigatório." }

Set-EnvValue $paths.EnvFile "FACEBOOK_APP_ID" $appId.Trim()
Set-EnvValue $paths.EnvFile "FACEBOOK_APP_SECRET" $appSecret.Trim()

Write-Host "Recriando Postiz com as credenciais Meta..." -ForegroundColor Cyan
Invoke-PostizCompose up -d --force-recreate postiz

$values = Read-EnvFile $paths.EnvFile
$base = $values["POSTIZ_PUBLIC_URL"]
if (-not $base) { $base = "http://localhost:4007" }

Write-Host ""
Write-Host "Credenciais Meta salvas somente em .runtime/postiz-modo.env (ignorado pelo Git)." -ForegroundColor Green
Write-Host "Cadastre estes Redirect URIs no Meta Developers:" -ForegroundColor Cyan
Write-Host "$base/integrations/social/facebook"
Write-Host "$base/integrations/social/instagram"
Write-Host "$base/integrations/social/instagram-standalone"
