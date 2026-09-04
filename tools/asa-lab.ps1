[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('up', 'doctor', 'health', 'status', 'logs', 'down')]
  [string]$Action = 'up',

  [ValidateSet('base', 'dev', 'test', 'staging', 'production')]
  [string]$Profile = 'dev'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$EnvPath = Join-Path $RepoRoot '.env'
$ComposeFiles = @('-f', 'compose.yaml')
if ($Profile -ne 'base') {
  $ComposeFiles += @('-f', "compose.$Profile.yaml")
}
Set-Location $RepoRoot

if (-not $env:ASA_BUILD_REVISION) {
  $env:ASA_BUILD_REVISION = 'unknown'
  if (Get-Command git -ErrorAction SilentlyContinue) {
    $candidate = (& git rev-parse HEAD 2>$null)
    if ($LASTEXITCODE -eq 0 -and $candidate) {
      $env:ASA_BUILD_REVISION = $candidate.Trim()
    }
  }
}

if (-not $env:ASA_EXPECTED_SCHEMA_VERSION) {
  $migrationVersions = @(
    Get-ChildItem -LiteralPath (Join-Path $RepoRoot 'migrations') -Filter '*.sql' -File |
      ForEach-Object {
        if ($_.BaseName -match '^(\d+)_') { [int]$Matches[1] }
      }
  )
  if ($migrationVersions.Count -eq 0) {
    throw 'No numbered SQL migrations were found.'
  }
  $env:ASA_EXPECTED_SCHEMA_VERSION = [string](($migrationVersions | Measure-Object -Maximum).Maximum)
}

function Assert-LastExitCode {
  param([string]$Operation)
  if ($LASTEXITCODE -ne 0) {
    throw "$Operation failed with exit code $LASTEXITCODE."
  }
}

function Invoke-Compose {
  param([string[]]$Command)
  & docker compose @ComposeFiles @Command
  Assert-LastExitCode 'docker compose'
}

function Assert-Docker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker is required. Install Docker Desktop with Linux containers and Compose.'
  }
  & docker version *> $null
  Assert-LastExitCode 'docker version'
  & docker compose version *> $null
  Assert-LastExitCode 'docker compose version'
}

function New-RandomHex {
  param([int]$ByteCount = 24)
  $bytes = New-Object byte[] $ByteCount
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function New-PrivateEnvironment {
  $productionLike = $Profile -in @('staging', 'production')
  if (Test-Path -LiteralPath $EnvPath) {
    $existing = Get-Content -Raw -LiteralPath $EnvPath
    if ($existing -match 'replace-with|CHANGE_ME|change-me') {
      throw '.env still contains placeholder credentials; replace them or remove .env and rerun.'
    }
    $requiredMigrationSettings = @(
      'MIGRATION_DATABASE_URL',
      'MIGRATION_EXPECT_DATABASE',
      'MIGRATION_CONFIRM'
    )
    $missingMigrationSettings = @(
      $requiredMigrationSettings | Where-Object { $existing -notmatch "(?m)^$([regex]::Escape($_))=\S" }
    )
    if ($missingMigrationSettings.Count -gt 0) {
      throw "Legacy .env is missing the dedicated migration target guard ($($missingMigrationSettings -join ', ')). Add all three settings and use MIGRATION_CONFIRM=APPLY:<exact-database-name>; generic DATABASE_URL is not accepted."
    }
    if ($existing -notmatch '(?m)^ASA_SETTINGS_ENCRYPTION_KEY=(?:[a-fA-F0-9]{64}|[A-Za-z0-9_-]{43})\s*$') {
      Add-Content -LiteralPath $EnvPath -Value "`nASA_SETTINGS_ENCRYPTION_KEY=$(New-RandomHex -ByteCount 32)"
      Write-Host 'Added a private runtime settings encryption key to .env.'
    }
    if ($productionLike -and $existing -notmatch '(?m)^ASA_SEED_DEV=false\s*$') {
      throw "$Profile requires ASA_SEED_DEV=false in .env. Refusing to seed development accounts into a production-like database."
    }
    return
  }

  $adminPassword = New-RandomHex
  $runtimePassword = New-RandomHex
  $teacherPassword = New-RandomHex
  $settingsEncryptionKey = New-RandomHex -ByteCount 32
  $projectName = if ($Profile -eq 'production') { 'asa-lab-production' } elseif ($Profile -eq 'staging') { 'asa-lab-staging' } else { 'asa-lab-dev' }
  $seedDev = if ($productionLike) { 'false' } else { 'true' }
  $content = @"
# Generated locally by tools/asa-lab.ps1. Never commit this file.
COMPOSE_PROJECT_NAME=$projectName
ASA_IMAGE_TAG=local
ASA_TEST_UID=1000
ASA_TEST_GID=1000

POSTGRES_DB=asalab
POSTGRES_USER=asalab_admin
POSTGRES_PASSWORD=$adminPassword
ASA_APP_DB_PASSWORD=$runtimePassword
MIGRATION_DATABASE_URL=postgres://asalab_admin:$adminPassword@postgres:5432/asalab
MIGRATION_EXPECT_DATABASE=asalab
MIGRATION_CONFIRM=APPLY:asalab
APP_DATABASE_URL=postgres://asalab_app:$runtimePassword@postgres:5432/asalab
ASA_SETTINGS_ENCRYPTION_KEY=$settingsEncryptionKey

ASA_WEB_PORT=4610
ASA_API_PORT=4611
ASA_SEED_DEV=$seedDev
ASA_SEED_WORKSPACE=school-1580
ASA_SEED_TEACHER_EMAIL=teacher@school-1580.local
ASA_SEED_TEACHER_PASSWORD=$teacherPassword
"@

  [System.IO.File]::WriteAllText(
    $EnvPath,
    $content.TrimStart(),
    [System.Text.UTF8Encoding]::new($false)
  )
  Write-Host 'Created private .env with generated credentials.'
}

function Get-EnvironmentValue {
  param([string]$Name)
  $line = Get-Content -LiteralPath $EnvPath | Where-Object { $_ -like "$Name=*" } | Select-Object -Last 1
  if (-not $line) { return '' }
  return $line.Substring($Name.Length + 1)
}

function Test-Ready {
  $output = & docker compose @ComposeFiles exec -T web wget -q -O - http://127.0.0.1:8080/health/ready 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $output) { return $false }
  try {
    return (($output | Out-String | ConvertFrom-Json).status -eq 'ready')
  } catch {
    return $false
  }
}

function Wait-Ready {
  $deadline = [DateTime]::UtcNow.AddMinutes(5)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Ready) { return }
    Start-Sleep -Seconds 2
  }

  Write-Error 'ASA Lab did not become ready within 5 minutes.' -ErrorAction Continue
  & docker compose @ComposeFiles ps -a
  & docker compose @ComposeFiles logs --tail=120 postgres migration api web
  throw 'Deployment health check failed.'
}

function Show-Access {
  Write-Host ''
  Write-Host 'ASA Lab is ready: http://127.0.0.1:4610'
  Write-Host "Revision: $env:ASA_BUILD_REVISION"
  Write-Host "Schema: $env:ASA_EXPECTED_SCHEMA_VERSION"
  if ((Get-EnvironmentValue 'ASA_SEED_DEV') -eq 'true') {
    Write-Host "Teacher: $(Get-EnvironmentValue 'ASA_SEED_TEACHER_EMAIL')"
    Write-Host "Password: $(Get-EnvironmentValue 'ASA_SEED_TEACHER_PASSWORD')"
  }
  Write-Host 'Credentials are stored only in .env.'
}

switch ($Action) {
  'doctor' {
    Assert-Docker
    New-PrivateEnvironment
    Invoke-Compose @('config', '--quiet')
    Write-Host 'Deployment doctor PASS: Docker, Compose and private configuration are ready.'
    Write-Host "Profile: $Profile"
    Write-Host "Revision: $env:ASA_BUILD_REVISION"
    Write-Host "Schema: $env:ASA_EXPECTED_SCHEMA_VERSION"
  }
  'up' {
    Assert-Docker
    New-PrivateEnvironment
    Invoke-Compose @('config', '--quiet')
    Invoke-Compose @('up', '-d', '--build')
    Wait-Ready
    Invoke-Compose @('ps')
    Show-Access
  }
  'health' {
    Assert-Docker
    if (-not (Test-Ready)) { throw 'Docker health FAIL' }
    Write-Host 'Docker health PASS: http://127.0.0.1:4610'
  }
  'status' {
    Assert-Docker
    Invoke-Compose @('ps', '-a')
  }
  'logs' {
    Assert-Docker
    Invoke-Compose @('logs', '--tail=200', 'postgres', 'migration', 'api', 'web')
  }
  'down' {
    Assert-Docker
    Invoke-Compose @('down', '--remove-orphans')
    Write-Host 'ASA Lab stopped; PostgreSQL data volume was preserved.'
  }
}
