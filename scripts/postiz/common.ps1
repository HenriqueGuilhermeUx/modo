Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-MODORepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function Get-PostizPaths {
  $root = Get-MODORepoRoot
  $runtime = Join-Path $root ".runtime"
  return [ordered]@{
    Root = $root
    Runtime = $runtime
    PostizRepo = Join-Path $runtime "postiz"
    EnvFile = Join-Path $runtime "postiz-modo.env"
    OverrideFile = Join-Path $root "infra\postiz\docker-compose.modo.yml"
    TunnelDir = Join-Path $runtime "postiz-tunnel"
    TunnelPid = Join-Path $runtime "postiz-tunnel\cloudflared.pid"
    TunnelStdout = Join-Path $runtime "postiz-tunnel\cloudflared.stdout.log"
    TunnelStderr = Join-Path $runtime "postiz-tunnel\cloudflared.stderr.log"
    TunnelUrl = Join-Path $runtime "postiz-tunnel\public-url.txt"
  }
}

function Assert-Command([string]$Name, [string]$InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Comando '$Name' não encontrado. $InstallHint"
  }
}

function New-RandomSecret([int]$Bytes = 48) {
  $buffer = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return [Convert]::ToHexString($buffer).ToLowerInvariant()
}

function Ensure-PostizEnv {
  param([switch]$Reset)
  $paths = Get-PostizPaths
  New-Item -ItemType Directory -Force -Path $paths.Runtime | Out-Null
  if ((Test-Path $paths.EnvFile) -and -not $Reset) { return $paths.EnvFile }

  $secret = New-RandomSecret
  @"
POSTIZ_PUBLIC_URL=http://localhost:4007
POSTIZ_JWT_SECRET=$secret
POSTIZ_DISABLE_REGISTRATION=false
POSTIZ_API_LIMIT=90
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
THREADS_APP_ID=
THREADS_APP_SECRET=
"@ | Set-Content -Path $paths.EnvFile -Encoding utf8
  return $paths.EnvFile
}

function Read-EnvFile([string]$Path) {
  $values = @{}
  if (-not (Test-Path $Path)) { return $values }
  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) { continue }
    $parts = $trimmed.Split("=", 2)
    $values[$parts[0].Trim()] = $parts[1]
  }
  return $values
}

function Set-EnvValue([string]$Path, [string]$Key, [string]$Value) {
  $lines = @()
  if (Test-Path $Path) { $lines = @(Get-Content $Path) }
  $escapedKey = [Regex]::Escape($Key)
  $found = $false
  $next = foreach ($line in $lines) {
    if ($line -match "^$escapedKey=") {
      $found = $true
      "$Key=$Value"
    } else { $line }
  }
  if (-not $found) { $next += "$Key=$Value" }
  $next | Set-Content -Path $Path -Encoding utf8
}

function Get-ComposeArgs {
  $paths = Get-PostizPaths
  $official = Join-Path $paths.PostizRepo "docker-compose.yaml"
  if (-not (Test-Path $official)) {
    throw "Compose oficial não encontrado. Rode scripts/postiz/bootstrap.ps1 primeiro."
  }
  return @(
    "compose",
    "--env-file", $paths.EnvFile,
    "-f", $official,
    "-f", $paths.OverrideFile
  )
}

function Invoke-PostizCompose {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
  $paths = Get-PostizPaths
  $compose = Get-ComposeArgs
  Push-Location $paths.PostizRepo
  try {
    & docker @compose @Arguments
    if ($LASTEXITCODE -ne 0) { throw "docker compose falhou com código $LASTEXITCODE." }
  } finally {
    Pop-Location
  }
}

function Wait-Http([string]$Url, [int]$Seconds = 180) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8
      if ($response.StatusCode -lt 500) { return $true }
    } catch { Start-Sleep -Seconds 3; continue }
    Start-Sleep -Seconds 3
  }
  return $false
}

function Stop-CloudflaredIfRunning {
  $paths = Get-PostizPaths
  if (-not (Test-Path $paths.TunnelPid)) { return }
  $pidText = (Get-Content $paths.TunnelPid -Raw).Trim()
  if ($pidText -match "^\d+$") {
    $process = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
    if ($process) { Stop-Process -Id $process.Id -Force }
  }
  Remove-Item $paths.TunnelPid -Force -ErrorAction SilentlyContinue
}
