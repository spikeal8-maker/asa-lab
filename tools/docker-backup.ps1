[CmdletBinding()]
param(
  [string]$Output = 'backups/asa-lab.dump',

  [ValidateSet('base', 'dev', 'test', 'staging', 'production')]
  [string]$Profile = 'base'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

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

$OutputPath = if ([System.IO.Path]::IsPathRooted($Output)) {
  $Output
} else {
  Join-Path $RepoRoot $Output
}
$ResolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$OutputDirectory = Split-Path -Parent $ResolvedOutput
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$ContainerBackup = "/tmp/asa-lab-backup-$([guid]::NewGuid().ToString('N')).dump"
try {
  Invoke-Compose @(
    'exec', '-T', '-e', "BACKUP_PATH=$ContainerBackup", 'postgres', 'sh', '-eu', '-c',
    'pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$BACKUP_PATH"; pg_restore --list "$BACKUP_PATH" >/dev/null; chmod 600 "$BACKUP_PATH"'
  )
  Invoke-Compose @('cp', "postgres:$ContainerBackup", $ResolvedOutput)
  $Backup = Get-Item -LiteralPath $ResolvedOutput
  if ($Backup.Length -le 0) {
    throw 'Docker backup is empty.'
  }
  Write-Host "Docker backup PASS: $ResolvedOutput ($($Backup.Length) bytes)"
} finally {
  & docker compose @ComposeFiles exec -T -e "BACKUP_PATH=$ContainerBackup" postgres sh -eu -c 'rm -f -- "$BACKUP_PATH"' 2>$null
}
