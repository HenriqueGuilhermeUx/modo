param(
  [switch]$ResetLocalConfig
)

. "$PSScriptRoot\common.ps1"

Assert-Command "git" "Instale o Git for Windows e abra um novo PowerShell."
Assert-Command "docker" "Instale o Docker Desktop e aguarde o Docker Engine iniciar."

$paths = Get-PostizPaths
New-Item -ItemType Directory -Force -Path $paths.Runtime | Out-Null

if (Test-Path (Join-Path $paths.PostizRepo ".git")) {
  Write-Host "Atualizando compose oficial do Postiz..." -ForegroundColor Cyan
  git -C $paths.PostizRepo fetch --depth 1 origin main
  if ($LASTEXITCODE -ne 0) { throw "Falha ao atualizar o repositório oficial do Postiz." }
  git -C $paths.PostizRepo reset --hard origin/main
  if ($LASTEXITCODE -ne 0) { throw "Falha ao sincronizar o repositório oficial do Postiz." }
} else {
  if (Test-Path $paths.PostizRepo) { Remove-Item -Recurse -Force $paths.PostizRepo }
  Write-Host "Clonando compose oficial do Postiz..." -ForegroundColor Cyan
  git clone --depth 1 https://github.com/gitroomhq/postiz-docker-compose $paths.PostizRepo
  if ($LASTEXITCODE -ne 0) { throw "Falha ao clonar gitroomhq/postiz-docker-compose." }
}

$envFile = Ensure-PostizEnv -Reset:$ResetLocalConfig

Write-Host "Validando Docker Compose..." -ForegroundColor Cyan
$compose = Get-ComposeArgs
Push-Location $paths.PostizRepo
try {
  & docker @compose config --quiet
  if ($LASTEXITCODE -ne 0) { throw "A configuração Docker Compose não é válida." }
} finally { Pop-Location }

Write-Host ""
Write-Host "Postiz self-hosted preparado." -ForegroundColor Green
Write-Host "Compose oficial: $($paths.PostizRepo)"
Write-Host "Configuração local privada: $envFile"
Write-Host "Próximo comando: powershell -ExecutionPolicy Bypass -File scripts/postiz/start-local.ps1"
