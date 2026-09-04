[CmdletBinding()]
param(
  [ValidateSet('base', 'dev', 'staging', 'production')]
  [string]$Profile = 'production',
  [ValidateSet('auto', 'none', 'frp')]
  [string]$Transport = 'auto',
  [string]$BackupDirectory = 'backups',
  [switch]$CheckOnly,
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $RepoRoot

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command exited with code $LASTEXITCODE"
  }
}

function Get-EnvValue {
  param([Parameter(Mandatory = $true)][string]$Name)

  $line = Get-Content -LiteralPath '.env' -Encoding UTF8 |
    Where-Object { $_ -match "^$([regex]::Escape($Name))=" } |
    Select-Object -Last 1
  if (-not $line) { return $null }
  return ($line -split '=', 2)[1].Trim()
}

function Get-ComposeArguments {
  $arguments = @('compose', '-f', 'compose.yaml')
  if ($Profile -ne 'base') {
    $profilePath = "compose.$Profile.yaml"
    if (-not (Test-Path -LiteralPath $profilePath)) {
      throw "Compose profile is missing: $profilePath"
    }
    $arguments += @('-f', $profilePath)
  }

  $includeFrp = $Transport -eq 'frp' -or
    ($Transport -eq 'auto' -and (Test-Path -LiteralPath 'compose.frp.yaml'))
  if ($Transport -eq 'frp' -and -not (Test-Path -LiteralPath 'compose.frp.yaml')) {
    throw 'FRP transport was requested, but local compose.frp.yaml is missing.'
  }
  if ($includeFrp) {
    $arguments += @('-f', 'compose.frp.yaml')
  }
  return $arguments
}

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  & docker @script:ComposeArguments @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose exited with code $LASTEXITCODE"
  }
}

function Get-LatestSchemaVersion {
  $versions = Get-ChildItem -LiteralPath 'migrations' -Filter '*.sql' -File |
    ForEach-Object {
      if ($_.Name -match '^([0-9]+)_') { [int]$Matches[1] }
    }
  if (-not $versions) { throw 'Cannot determine schema version from migrations/*.sql.' }
  return ($versions | Measure-Object -Maximum).Maximum
}

function Assert-ContainerRunning {
  param([Parameter(Mandatory = $true)][string]$Service)

  $containerId = (& docker @script:ComposeArguments ps -q $Service).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $containerId) {
    throw "Service $Service is absent from the selected Compose project; guarded update is not a bootstrap command."
  }
  $running = (& docker inspect --format '{{.State.Running}}' $containerId).Trim()
  if ($LASTEXITCODE -ne 0 -or $running -ne 'true') {
    throw "Service $Service is not running. Inspect the installation before updating."
  }
  return $containerId
}

function Get-ContainerWorkingDirectory {
  param([Parameter(Mandatory = $true)][string]$ContainerId)

  $inspectJson = & docker inspect $ContainerId
  if ($LASTEXITCODE -ne 0) {
    throw "Cannot inspect Compose working directory for container $ContainerId."
  }
  $inspect = $inspectJson | ConvertFrom-Json
  $record = @($inspect)[0]
  $label = $record.Config.Labels.PSObject.Properties[
    'com.docker.compose.project.working_dir'
  ]
  if (-not $label) { return '' }
  return [string]$label.Value
}

function Test-SamePath {
  param(
    [Parameter(Mandatory = $true)][string]$Left,
    [Parameter(Mandatory = $true)][string]$Right
  )

  $leftPath = [System.IO.Path]::GetFullPath($Left).TrimEnd('\', '/')
  $rightPath = [System.IO.Path]::GetFullPath($Right).TrimEnd('\', '/')
  return [string]::Equals($leftPath, $rightPath, [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-MixedOriginServices {
  param([string[]]$Services = @('postgres', 'api', 'web'))

  $drift = @()
  foreach ($service in $Services) {
    $containerId = (& docker @script:ComposeArguments ps -q $service).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $containerId) { continue }
    $workingDirectory = Get-ContainerWorkingDirectory $containerId
    if (-not $workingDirectory -or -not (Test-SamePath $workingDirectory $RepoRoot)) {
      $shownDirectory = if ($workingDirectory) { $workingDirectory } else { '<missing>' }
      $drift += "$service=$shownDirectory"
    }
  }
  return $drift
}

function Assert-CanonicalDatabaseOrigin {
  param([Parameter(Mandatory = $true)][string]$PostgresContainerId)

  $databaseOrigin = Get-ContainerWorkingDirectory $PostgresContainerId
  if (-not $databaseOrigin) {
    throw 'The running PostgreSQL container has no Compose working-directory label; deployment root is unknown.'
  }
  if (-not (Test-SamePath $databaseOrigin $RepoRoot)) {
    throw "This checkout is not the database deployment root. PostgreSQL belongs to $databaseOrigin; run the updater there."
  }
}

function New-DatabaseBackup {
  param([Parameter(Mandatory = $true)][string]$OutputPath)

  $containerPath = "/tmp/asa-lab-update-$([guid]::NewGuid().ToString('N')).dump"
  try {
    Invoke-Compose exec -T -e "BACKUP_PATH=$containerPath" postgres sh -eu -c `
      'pg_dump --format=custom --no-owner --no-acl --dbname="$POSTGRES_DB" --username="$POSTGRES_USER" --file="$BACKUP_PATH"; pg_restore --list "$BACKUP_PATH" >/dev/null; chmod 0644 "$BACKUP_PATH"'
    Invoke-Compose cp "postgres:$containerPath" $OutputPath
  }
  finally {
    & docker @script:ComposeArguments exec -T -e "BACKUP_PATH=$containerPath" postgres sh -c `
      'rm -f "$BACKUP_PATH"' 2>$null
  }

  if (-not (Test-Path -LiteralPath $OutputPath)) {
    throw "Backup file was not created: $OutputPath"
  }
  $backup = Get-Item -LiteralPath $OutputPath
  if ($backup.Length -le 0) { throw "Backup file is empty: $OutputPath" }
  return (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Save-RollbackImage {
  param(
    [Parameter(Mandatory = $true)][string]$Service,
    [Parameter(Mandatory = $true)][string]$Revision
  )

  $containerId = (& docker @script:ComposeArguments ps -q $Service).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $containerId) { return $null }
  $imageId = (& docker inspect --format '{{.Image}}' $containerId).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $imageId) { return $null }
  $tag = "asa-lab-$Service`:rollback-$($Revision.Substring(0, 8))"
  Invoke-Native docker image tag $imageId $tag
  return $tag
}

function Select-RequiredWorkflowRun {
  param(
    [Parameter(Mandatory = $true)]$Runs,
    [Parameter(Mandatory = $true)][string]$Revision
  )

  foreach ($candidate in $Runs) {
    if (
      $candidate.headSha -eq $Revision -and
      $candidate.name -eq 'ASA Lab Governance and Code Gates'
    ) {
      return $candidate
    }
  }
  return $null
}

function Assert-GitHubCiSuccess {
  param([Parameter(Mandatory = $true)][string]$Revision)

  $origin = (& git remote get-url origin).Trim()
  if ($LASTEXITCODE -ne 0 -or $origin -notmatch 'github\.com[/:](?<repository>[^/\s]+/[^/\s]+?)(?:\.git)?$') {
    throw 'Origin is not a supported GitHub repository; exact CI status cannot be verified.'
  }
  $repository = $Matches.repository
  if (Get-Command gh -ErrorAction SilentlyContinue) {
    $ghJson = & gh run list --repo $repository --commit $Revision `
      --json headSha,name,status,conclusion,url --limit 20 2>$null
    if ($LASTEXITCODE -eq 0) {
      $runs = $ghJson | ConvertFrom-Json
      $run = Select-RequiredWorkflowRun -Runs $runs -Revision $Revision
      if (-not $run) {
        throw "Required GitHub workflow was not found for $Revision. Wait for CI to start and retry."
      }
      if ($run.status -ne 'completed' -or $run.conclusion -ne 'success') {
        throw "Required GitHub workflow is $($run.status)/$($run.conclusion): $($run.url)"
      }
      Write-Host "CI OK: $($run.url)"
      return
    }
  }

  $probe = @'
const repository = process.env.GITHUB_REPOSITORY;
const revision = process.env.TARGET_SHA;
const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "asa-lab-guarded-updater",
};
if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
const url = `https://api.github.com/repos/${repository}/actions/runs?head_sha=${revision}&branch=main&per_page=30`;
fetch(url, { headers })
  .then(async (response) => {
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    return response.json();
  })
  .then((payload) => {
    const run = (payload.workflow_runs || []).find((candidate) =>
      candidate.head_sha === revision && candidate.name === "ASA Lab Governance and Code Gates");
    if (!run) throw new Error(`required workflow was not found for ${revision}`);
    if (run.status !== "completed" || run.conclusion !== "success") {
      throw new Error(`workflow is ${run.status}/${run.conclusion || "pending"}: ${run.html_url}`);
    }
    console.log(`CI OK: ${run.html_url}`);
  })
  .catch((problem) => {
    console.error(`CI BLOCKED: ${problem.message}`);
    process.exit(1);
  });
'@
  $probeBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($probe))
  $ciArguments = @(
    'exec', '-T',
    '-e', "GITHUB_REPOSITORY=$repository",
    '-e', "TARGET_SHA=$Revision"
  )
  if ($env:GH_TOKEN) { $ciArguments += @('-e', 'GH_TOKEN') }
  $ciArguments += @(
    'api',
    'node',
    '-e',
    'eval(Buffer.from(process.argv[1],process.argv[2]).toString())',
    $probeBase64,
    'base64'
  )
  Invoke-Compose @ciArguments
}

function Wait-ExactReadiness {
  param(
    [Parameter(Mandatory = $true)][string]$Revision,
    [Parameter(Mandatory = $true)][int]$SchemaVersion,
    [int]$Attempts = 60
  )

  $webPort = Get-EnvValue 'ASA_WEB_PORT'
  if (-not $webPort) { $webPort = '4610' }
  $uri = "http://127.0.0.1:$webPort/health/ready"
  $metadataUri = "http://127.0.0.1:$webPort/build-metadata.json"

  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      $ready = Invoke-RestMethod -Uri $uri -TimeoutSec 2
      $webMetadata = Invoke-RestMethod -Uri $metadataUri -TimeoutSec 2
      if (
        $ready.status -eq 'ready' -and
        $ready.deployment.revision -eq $Revision -and
        $webMetadata.revision -eq $Revision -and
        [int]$ready.deployment.schemaVersion -eq $SchemaVersion -and
        [int]$ready.deployment.expectedSchemaVersion -eq $SchemaVersion -and
        $ready.deployment.synchronized -eq $true
      ) {
        return $ready
      }
    }
    catch {
      # Containers may be unavailable briefly during the expected startup window.
    }
    Start-Sleep -Seconds 3
  }

  throw "Readiness did not confirm matching API/Web revision=$Revision, schema=$SchemaVersion and synchronized=true within the startup window."
}

function Write-Receipt {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Values
  )

  $lines = foreach ($key in $Values.Keys) { "$key=$($Values[$key])" }
  [System.IO.File]::WriteAllLines($Path, $lines, [System.Text.UTF8Encoding]::new($false))
}

function Invoke-GuardedUpdate {
  foreach ($command in @('git', 'docker')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
      throw "Required command is missing: $command"
    }
  }
  Invoke-Native docker version --format '{{.Server.Version}}'
  Invoke-Native docker compose version

  if (-not (Test-Path -LiteralPath '.env')) {
    throw '.env is missing; guarded update never creates or guesses production secrets.'
  }
  $projectName = Get-EnvValue 'COMPOSE_PROJECT_NAME'
  if (-not $projectName) {
    throw 'COMPOSE_PROJECT_NAME is missing from .env; the existing PostgreSQL volume cannot be identified safely.'
  }
  if ($Profile -eq 'production' -and (Get-EnvValue 'ASA_SEED_DEV') -ne 'false') {
    throw 'Production update requires ASA_SEED_DEV=false in .env.'
  }
  if ($env:COMPOSE_PROJECT_NAME -and $env:COMPOSE_PROJECT_NAME -ne $projectName) {
    throw 'The process COMPOSE_PROJECT_NAME differs from .env; refusing to select an ambiguous PostgreSQL volume.'
  }
  $env:COMPOSE_PROJECT_NAME = $projectName

  $branch = (& git branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') {
    throw "Guarded update is allowed only from main; current branch: $branch"
  }
  $initialStatus = @(& git status --porcelain)
  if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the Git working tree.' }
  if ($initialStatus.Count -gt 0) {
    throw 'Working tree is dirty; updater never discards local changes.'
  }

  $script:ComposeArguments = Get-ComposeArguments
  Invoke-Compose config --quiet
  $postgresContainerId = Assert-ContainerRunning 'postgres'
  Assert-CanonicalDatabaseOrigin $postgresContainerId
  $originDrift = @(Get-MixedOriginServices)
  if ($originDrift.Count -gt 0) {
    Write-Warning "Mixed Compose working directories detected: $($originDrift -join '; ')"
  }

  Invoke-Native git fetch origin main
  $counts = (& git rev-list --left-right --count HEAD...origin/main).Trim() -split '\s+'
  if ($LASTEXITCODE -ne 0 -or $counts.Count -ne 2) {
    throw 'Cannot compare local main with origin/main.'
  }
  $ahead = [int]$counts[0]
  $behind = [int]$counts[1]
  if ($ahead -gt 0) {
    throw "Local main contains $ahead unpublished commit(s); automatic merge/rebase is forbidden."
  }

  $oldRevision = (& git rev-parse HEAD).Trim()
  $targetRevision = (& git rev-parse origin/main).Trim()
  Assert-GitHubCiSuccess $targetRevision
  $transportLabel = if ($script:ComposeArguments -contains 'compose.frp.yaml') { 'frp' } else { 'none' }
  Write-Host "CHECK project=$projectName profile=$Profile transport=$transportLabel"
  Write-Host "CHECK current=$oldRevision target=$targetRevision behind=$behind"

  if ($CheckOnly) {
    if ($originDrift.Count -gt 0) {
      throw 'CHECK BLOCKED: the installation mixes containers from different checkouts. Run the full guarded updater from the PostgreSQL deployment root to reconcile it.'
    }
    Write-Host 'CHECK OK: no code, container or database changes were made.'
    return
  }

  $backupRoot = if ([System.IO.Path]::IsPathRooted($BackupDirectory)) {
    $BackupDirectory
  }
  else {
    Join-Path $RepoRoot $BackupDirectory
  }
  [void](New-Item -ItemType Directory -Force -Path $backupRoot)
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmssZ')
  $backupPath = Join-Path $backupRoot "pre-update-$stamp-$($oldRevision.Substring(0, 8)).dump"
  $backupSha256 = New-DatabaseBackup $backupPath
  Write-Host "BACKUP OK: $backupPath"
  Write-Host "BACKUP SHA256: $backupSha256"

  $rollbackApi = Save-RollbackImage 'api' $oldRevision
  $rollbackWeb = Save-RollbackImage 'web' $oldRevision

  Invoke-Native git pull --ff-only origin main
  $newRevision = (& git rev-parse HEAD).Trim()
  $remoteRevision = (& git rev-parse origin/main).Trim()
  if ($newRevision -ne $remoteRevision) {
    throw "Local SHA $newRevision does not match origin/main $remoteRevision after pull."
  }
  $finalStatus = @(& git status --porcelain)
  if ($LASTEXITCODE -ne 0) { throw 'Cannot re-check the Git working tree.' }
  if ($finalStatus.Count -gt 0) {
    throw 'Working tree became dirty after fast-forward; build stopped.'
  }

  $schemaVersion = Get-LatestSchemaVersion
  $env:ASA_BUILD_REVISION = $newRevision
  $env:ASA_IMAGE_TAG = $newRevision.Substring(0, 12)
  $env:ASA_EXPECTED_SCHEMA_VERSION = [string]$schemaVersion

  $receiptPath = Join-Path $backupRoot "update-$stamp-$($newRevision.Substring(0, 8)).receipt.txt"
  try {
    Invoke-Compose config --quiet
    Invoke-Compose up -d --build
    [void](Wait-ExactReadiness -Revision $newRevision -SchemaVersion $schemaVersion)
    $remainingOriginDrift = @(Get-MixedOriginServices)
    if ($remainingOriginDrift.Count -gt 0) {
      throw "Containers still have mixed Compose working directories: $($remainingOriginDrift -join '; ')"
    }
    Write-Receipt $receiptPath ([ordered]@{
      status = 'success'
      updated_at_utc = $stamp
      compose_project = $projectName
      profile = $Profile
      transport = $transportLabel
      previous_revision = $oldRevision
      deployed_revision = $newRevision
      schema_version = $schemaVersion
      backup_path = $backupPath
      backup_sha256 = $backupSha256
      rollback_api_image = $rollbackApi
      rollback_web_image = $rollbackWeb
    })
  }
  catch {
    Write-Receipt $receiptPath ([ordered]@{
      status = 'failed_after_backup'
      updated_at_utc = $stamp
      compose_project = $projectName
      profile = $Profile
      transport = $transportLabel
      previous_revision = $oldRevision
      attempted_revision = $newRevision
      backup_path = $backupPath
      backup_sha256 = $backupSha256
      automatic_database_restore = 'forbidden'
    })
    Write-Warning 'Update stopped. The volume/database were NOT removed and no automatic restore was attempted.'
    Write-Warning "Diagnostics: docker $($script:ComposeArguments -join ' ') ps"
    & docker @script:ComposeArguments ps
    & docker @script:ComposeArguments logs --tail 120 api migration web
    throw
  }

  Write-Host "UPDATE OK: revision=$newRevision schema=$schemaVersion synchronized=true"
  Write-Host "RECEIPT: $receiptPath"
  Write-Host 'The PostgreSQL volume was preserved.'
}

function Invoke-UpdaterSelfTest {
  $revision = '0123456789abcdef0123456789abcdef01234567'
  $runsJson = @"
[
  {"headSha":"$revision","name":"Chess R1 Focused","status":"completed","conclusion":"failure"},
  {"headSha":"$revision","name":"ASA Lab Governance and Code Gates","status":"completed","conclusion":"success"},
  {"headSha":"$revision","name":"3D M0 Focused","status":"completed","conclusion":"failure"}
]
"@
  $runs = $runsJson | ConvertFrom-Json
  $selected = Select-RequiredWorkflowRun -Runs $runs -Revision $revision
  if (-not $selected -or $selected.conclusion -ne 'success') {
    throw 'Updater self-test failed to isolate the required workflow.'
  }
  if (-not (Test-SamePath $RepoRoot $RepoRoot)) {
    throw 'Updater self-test failed path normalization.'
  }
  $inspectFixture = @"
[{"Config":{"Labels":{"com.docker.compose.project.working_dir":"$($RepoRoot.Replace('\', '\\'))"}}}]
"@ | ConvertFrom-Json
  $label = $inspectFixture[0].Config.Labels.PSObject.Properties[
    'com.docker.compose.project.working_dir'
  ]
  if (-not $label -or -not (Test-SamePath ([string]$label.Value) $RepoRoot)) {
    throw 'Updater self-test failed Compose working-directory label parsing.'
  }
  Write-Host 'Docker updater self-test PASS'
}

if ($SelfTest) {
  Invoke-UpdaterSelfTest
} else {
  Invoke-GuardedUpdate
}
