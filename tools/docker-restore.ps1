[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Backup,

  [string]$RestoreDatabase = 'asalab_restore_test',

  [ValidateSet('base', 'dev', 'test', 'staging', 'production')]
  [string]$Profile = 'base'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($RestoreDatabase -notmatch '^[A-Za-z_][A-Za-z0-9_]*_test$') {
  throw 'RestoreDatabase must be a safe PostgreSQL identifier ending in _test.'
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$BackupPath = if ([System.IO.Path]::IsPathRooted($Backup)) {
  $Backup
} else {
  Join-Path $RepoRoot $Backup
}
$ResolvedBackup = [System.IO.Path]::GetFullPath($BackupPath)
if (-not (Test-Path -LiteralPath $ResolvedBackup -PathType Leaf)) {
  throw "Backup does not exist: $ResolvedBackup"
}
if ((Get-Item -LiteralPath $ResolvedBackup).Length -le 0) {
  throw 'Backup is empty.'
}

$ComposeFiles = @('-f', 'compose.yaml')
if ($Profile -ne 'base') {
  $ComposeFiles += @('-f', "compose.$Profile.yaml")
}

function Invoke-Compose {
  param([string[]]$Command)
  & docker compose @ComposeFiles @Command
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose failed with exit code $LASTEXITCODE."
  }
}

$ContainerBackup = "/tmp/asa-lab-restore-$([guid]::NewGuid().ToString('N')).dump"
try {
  Invoke-Compose @('cp', $ResolvedBackup, "postgres:$ContainerBackup")
  Invoke-Compose @(
    'exec', '-T', '-e', "BACKUP_PATH=$ContainerBackup", 'postgres', 'sh', '-eu', '-c',
    'pg_restore --list "$BACKUP_PATH" >/dev/null'
  )
  Invoke-Compose @(
    'exec', '-T', '-e', "RESTORE_DATABASE=$RestoreDatabase", 'postgres', 'sh', '-eu', '-c',
    'dropdb --if-exists --force -U "$POSTGRES_USER" "$RESTORE_DATABASE"; createdb -U "$POSTGRES_USER" "$RESTORE_DATABASE"'
  )
  Invoke-Compose @(
    'exec', '-T', '-e', "BACKUP_PATH=$ContainerBackup", '-e', "RESTORE_DATABASE=$RestoreDatabase", 'postgres', 'sh', '-eu', '-c',
    'pg_restore --exit-on-error --no-owner --no-acl -U "$POSTGRES_USER" -d "$RESTORE_DATABASE" "$BACKUP_PATH"'
  )
  Invoke-Compose @(
    'exec', '-T', '-e', "RESTORE_DATABASE=$RestoreDatabase", 'postgres', 'sh', '-eu', '-c',
    'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$RESTORE_DATABASE" -c "SELECT count(*) FROM schema_migrations" >/dev/null'
  )
  Write-Host "Docker restore PASS: $ResolvedBackup -> $RestoreDatabase"
} finally {
  & docker compose @ComposeFiles exec -T -e "BACKUP_PATH=$ContainerBackup" postgres sh -eu -c 'rm -f -- "$BACKUP_PATH"' 2>$null
}
