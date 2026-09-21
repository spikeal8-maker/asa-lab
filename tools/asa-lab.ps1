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
if ($Action -eq 'up' -and (Test-Path (Join-Path $RepoRoot '.asa/installed-release.json'))) {
  throw 'This installation uses published releases. Use tools/asa-manager.ps1 update.'
}
$EnvPath = Join-Path $RepoRoot '.env'
$ComposeFiles = @('-f', 'compose.yaml')
if ($Profile -ne 'base') {
  $ComposeFiles += @('-f', "compose.$Profile.yaml")
}
Set-Location $RepoRoot
. (Join-Path $PSScriptRoot 'installation-identity.ps1')

if (-not $env:ASA_BUILD_REVISION) {
  $env:ASA_BUILD_REVISION = 'unknown'
  if ((Test-Path (Join-Path $RepoRoot '.git')) -and (Get-Command git -ErrorAction SilentlyContinue)) {
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

function Assert-StartupIdentity {
  $defaultProject = if ($Profile -eq 'production') { 'asa-lab-production' } elseif ($Profile -eq 'staging') { 'asa-lab-staging' } else { 'asa-lab-dev' }
  Assert-AsaInstallationIdentity -Root $RepoRoot -DefaultProject $defaultProject -ComposeArguments $ComposeFiles
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
    if ($existing -notmatch '(?m)^ASA_BLOCKS_RUNTIME_SIGNING_KEY=[a-fA-F0-9]{64}\s*$') {
      Add-Content -LiteralPath $EnvPath -Value "`nASA_BLOCKS_RUNTIME_SIGNING_KEY=$(New-RandomHex -ByteCount 32)"
      Write-Host 'Added a private Blocks runtime signing key to .env.'
    }
    $storageNames = @('ASA_OBJECT_STORAGE_ENDPOINT','ASA_OBJECT_STORAGE_REGION','ASA_OBJECT_STORAGE_BUCKET','ASA_OBJECT_STORAGE_ACCESS_KEY','ASA_OBJECT_STORAGE_SECRET_KEY','ASA_OBJECT_STORAGE_FORCE_PATH_STYLE')
    $storagePresent = @($storageNames | Where-Object { $existing -match "(?m)^$([regex]::Escape($_))=\S" })
    if ($storagePresent.Count -eq 0) {
      $storageAccess = New-RandomHex -ByteCount 16
      $storageSecret = New-RandomHex -ByteCount 32
      Add-Content -LiteralPath $EnvPath -Value "`nASA_OBJECT_STORAGE_ENDPOINT=http://minio:9000`nASA_OBJECT_STORAGE_REGION=us-east-1`nASA_OBJECT_STORAGE_BUCKET=asa-blocks`nASA_OBJECT_STORAGE_ACCESS_KEY=$storageAccess`nASA_OBJECT_STORAGE_SECRET_KEY=$storageSecret`nASA_OBJECT_STORAGE_FORCE_PATH_STYLE=true"
      Write-Host 'Added private self-hosted Blocks object-storage configuration to .env.'
    } elseif ($storagePresent.Count -ne $storageNames.Count) {
      throw 'Existing .env has an incomplete ASA_OBJECT_STORAGE_* configuration; complete or remove the whole set before continuing.'
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
  $blocksRuntimeSigningKey = New-RandomHex -ByteCount 32
  $objectStorageAccessKey = New-RandomHex -ByteCount 16
  $objectStorageSecretKey = New-RandomHex -ByteCount 32
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
ASA_BLOCKS_RUNTIME_SIGNING_KEY=$blocksRuntimeSigningKey
ASA_OBJECT_STORAGE_ENDPOINT=http://minio:9000
ASA_OBJECT_STORAGE_REGION=us-east-1
ASA_OBJECT_STORAGE_BUCKET=asa-blocks
ASA_OBJECT_STORAGE_ACCESS_KEY=$objectStorageAccessKey
ASA_OBJECT_STORAGE_SECRET_KEY=$objectStorageSecretKey
ASA_OBJECT_STORAGE_FORCE_PATH_STYLE=true

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
    $ready = $output | Out-String | ConvertFrom-Json
    $metadata = & docker compose @ComposeFiles exec -T web wget -q -O - http://127.0.0.1:8080/build-metadata.json 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $metadata) { return $false }
    $scratchRevision = & docker compose @ComposeFiles exec -T scratch wget -q -O - http://127.0.0.1:8080/asa-commit.txt 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $scratchRevision) { return $false }
    & docker compose @ComposeFiles exec -T scratch wget -q -O - http://127.0.0.1:8080/healthz *> $null
    return ($LASTEXITCODE -eq 0 -and $ready.status -eq 'ready' -and
      $ready.deployment.revision -eq $env:ASA_BUILD_REVISION -and
      $ready.deployment.synchronized -eq $true -and
      ($metadata | Out-String | ConvertFrom-Json).revision -eq $env:ASA_BUILD_REVISION -and
      ($scratchRevision | Out-String).Trim() -eq $env:ASA_BUILD_REVISION)
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
  & docker compose @ComposeFiles logs --tail=120 postgres migration minio minio-init api web scratch
  throw 'Deployment health check failed.'
}

function Show-Access {
  Write-Host ''
  $parentOrigin = Get-EnvironmentValue 'ASA_BLOCKS_PARENT_ORIGIN'
  if (-not $parentOrigin) { $parentOrigin = 'http://127.0.0.1:4610' }
  Write-Host "ASA Lab with Scratch is ready: $parentOrigin"
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
    Assert-StartupIdentity
    New-PrivateEnvironment
    Invoke-Compose @('config', '--quiet')
    Write-Host 'Deployment doctor PASS: Docker, Compose and private configuration are ready.'
    Write-Host "Profile: $Profile"
    Write-Host "Revision: $env:ASA_BUILD_REVISION"
    Write-Host "Schema: $env:ASA_EXPECTED_SCHEMA_VERSION"
  }
  'up' {
    Assert-Docker
    Assert-StartupIdentity
    New-PrivateEnvironment
    Invoke-Compose @('config', '--quiet')
    # Build sequentially: a failed build never replaces healthy running containers.
    foreach ($service in @('minio', 'scratch', 'api', 'web')) { Invoke-Compose @('build', $service) }
    Assert-StartupIdentity
    Invoke-Compose @('up', '-d', '--no-build')
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
    Invoke-Compose @('logs', '--tail=200', 'postgres', 'migration', 'minio', 'minio-init', 'api', 'web', 'scratch')
  }
  'down' {
    Assert-Docker
    Assert-StartupIdentity
    Invoke-Compose @('down', '--remove-orphans')
    Write-Host 'ASA Lab stopped; PostgreSQL and Blocks object-storage data volumes were preserved.'
  }
}
