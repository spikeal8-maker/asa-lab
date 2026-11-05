[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-fA-F]{40}$')]
  [string]$ExpectedRevision,
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ExpectedComputerName
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ExpectedRevision = $ExpectedRevision.ToLowerInvariant()
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$dockerContext = 'desktop-linux'
$previousLocation = Get-Location
$previousEnvironment = @{}
$steps = New-Object 'System.Collections.Generic.List[object]'
$builderCreated = $false
$composeStarted = $false
$failure = $null
$cleanupFailures = New-Object 'System.Collections.Generic.List[string]'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Read-Native {
  param([string]$Executable, [string[]]$Arguments)
  $oldPreference = $ErrorActionPreference
  try {
    # PowerShell 5 wraps native stderr in ErrorRecords even for successful tools.
    $ErrorActionPreference = 'Continue'
    $output = @(& $Executable @Arguments 2>&1)
    $code = $LASTEXITCODE
  }
  finally { $ErrorActionPreference = $oldPreference }
  if ($code -ne 0) { throw "$Executable exited $code`: $($output -join [Environment]::NewLine)" }
  return ($output -join [Environment]::NewLine).Trim()
}

function Require-FreeMemory {
  $os = Get-CimInstance Win32_OperatingSystem
  $freeMiB = [math]::Floor($os.FreePhysicalMemory / 1024)
  if ($freeMiB -lt 3584) {
    throw "Only $freeMiB MiB physical memory is free. This proof needs at least 3584 MiB; no existing workload will be stopped."
  }
  return $freeMiB
}

function Save-Report {
  $report.steps = @($steps.ToArray())
  $report.cleanupFailures = @($cleanupFailures.ToArray())
  [IO.File]::WriteAllText((Join-Path $evidence 'report.json'), ($report | ConvertTo-Json -Depth 15), $utf8)
}

function Invoke-Docker {
  param([string]$Name, [string[]]$Arguments, [switch]$AllowFailure)
  $log = Join-Path $evidence ($Name + '.log')
  $started = [DateTime]::UtcNow.ToString('o')
  $command = @('--context', $dockerContext) + $Arguments
  Write-Host ([ordered]@{ step = $Name; event = 'start'; utc = $started } | ConvertTo-Json -Compress)
  $oldPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & docker @command > $log 2>&1
    $code = $LASTEXITCODE
  }
  finally { $ErrorActionPreference = $oldPreference }
  $step = [ordered]@{
    name = $Name; executable = 'docker'; arguments = $command; exitCode = $code
    startedAt = $started; finishedAt = [DateTime]::UtcNow.ToString('o'); log = $log
  }
  $steps.Add($step)
  Save-Report
  Write-Host ([ordered]@{ step = $Name; event = 'finish'; exitCode = $code } | ConvertTo-Json -Compress)
  if ($code -ne 0 -and -not $AllowFailure) {
    Get-Content -LiteralPath $log -Tail 25 | ForEach-Object { Write-Host $_ }
    throw "Docker step '$Name' failed with exit code $code."
  }
  return [pscustomobject]@{ ExitCode = $code; Output = [string](Get-Content -LiteralPath $log -Raw); Log = $log }
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This proof requires Windows Docker Desktop.' }
if ($env:COMPUTERNAME -ine $ExpectedComputerName) { throw 'Computer name does not match the explicitly selected test machine.' }
if ($env:COMPUTERNAME -ieq 'DESKTOP-R0HSMSA') { throw 'Production machine is excluded from this proof.' }
if (-not (Test-Path -LiteralPath (Join-Path $repo '.git'))) { throw 'Run the committed script from its clean Git clone.' }
$null = Get-Command git -CommandType Application
$null = Get-Command docker -CommandType Application
Set-Location -LiteralPath $repo
try {
  $head = Read-Native git @('rev-parse', 'HEAD')
  $origin = Read-Native git @('remote', 'get-url', 'origin')
  $dirty = Read-Native git @('status', '--porcelain=v1')
  if ($head -cne $ExpectedRevision) { throw "HEAD $head does not match ExpectedRevision $ExpectedRevision." }
  if ($origin -notmatch '^https://github\.com/spikeal8-maker/asa-lab(?:\.git)?/?$') { throw 'Origin must be the official ASA Lab GitHub repository.' }
  if ($dirty) { throw "The clone is not clean:`n$dirty" }
  if (Test-Path -LiteralPath (Join-Path $repo '.env')) { throw 'A local .env is not permitted in this isolated proof clone.' }
  if (@(Get-NetTCPConnection -LocalPort 4612 -State Listen -ErrorAction SilentlyContinue).Count) { throw 'Port 4612 is occupied; existing listeners will not be stopped.' }
  $freeMiB = Require-FreeMemory
  $endpoint = Read-Native docker @('--context', $dockerContext, 'context', 'inspect', $dockerContext, '--format', '{{.Endpoints.docker.Host}}')
  if ($endpoint -cne 'npipe:////./pipe/dockerDesktopLinuxEngine') { throw 'The selected Docker context is not the local Docker Desktop Linux engine.' }
  $engine = Read-Native docker @('--context', $dockerContext, 'info', '--format', '{{json .}}') | ConvertFrom-Json
  if ($engine.OSType -cne 'linux') { throw 'Linux containers are required.' }

  $runId = [guid]::NewGuid().ToString('N')
  $imageTag = $ExpectedRevision + '-storm-' + $runId.Substring(0, 8)
  $project = 'asa-storm-win-' + [DateTime]::UtcNow.ToString('yyyyMMdd') + '-' + $runId
  $builder = $project + '-build'
  $evidence = Join-Path $repo ('tmp\request-storm-windows\' + $runId)
  New-Item -ItemType Directory -Path $evidence -Force | Out-Null
  $report = [ordered]@{
    schemaVersion = 1; expectedRevision = $ExpectedRevision; sourceRevision = $head
    origin = $origin; cleanBefore = $true; machine = $env:COMPUTERNAME
    startedAt = [DateTime]::UtcNow.ToString('o'); completedAt = $null; success = $false; error = $null
    project = $project; builder = $builder; imageTag = $imageTag; evidenceDirectory = $evidence
    context = $dockerContext; endpoint = $endpoint; freePhysicalMiBBefore = $freeMiB
    versions = [ordered]@{ powershell = $PSVersionTable.PSVersion.ToString(); docker = $engine.ServerVersion; compose = (Read-Native docker @('--context', $dockerContext, 'compose', 'version')); buildx = (Read-Native docker @('--context', $dockerContext, 'buildx', 'version')); git = (Read-Native git @('--version')) }
    engine = [ordered]@{ cpus = $engine.NCPU; memoryBytes = $engine.MemTotal; existingRunningContainers = $engine.ContainersRunning }
    limits = [ordered]@{ buildMiB = 2560; buildCpus = 2; buildParallelism = 1; postgresMiB = 384; apiMiB = 512; webMiB = 128; runnerMiB = 1536 }
    preflightCommands = @('git rev-parse HEAD', 'git remote get-url origin', 'git status --porcelain=v1', 'Get-NetTCPConnection -LocalPort 4612 -State Listen', 'Get-CimInstance Win32_OperatingSystem', 'docker --context desktop-linux context inspect desktop-linux', 'docker --context desktop-linux info')
    steps = @(); cleanupFailures = @(); images = @(); ownedContainerLimits = @(); retainedVolumes = @()
    browserExitCode = $null; trackedSourceCleanAfter = $null
  }
  Save-Report

  # These are child-process environment values only. Restore them in finally;
  # no Docker daemon, global builder, user profile or deployment config changes.
  $managedNames = @('CI', 'GITHUB_ACTIONS', 'APP_DATABASE_URL', 'DATABASE_URL', 'CLASSROOM_CODE_SECRET', 'NX_SKIP_NX_CACHE', 'NX_DAEMON')
  $managedNames += @(Get-ChildItem Env: | Where-Object { $_.Name -match '^(ASA_|COMPOSE_|MIGRATION_|POSTGRES_)' } | ForEach-Object { $_.Name })
  $managedNames += @('ASA_BUILD_REVISION', 'ASA_IMAGE_TAG', 'COMPOSE_PROJECT_NAME', 'COMPOSE_PARALLEL_LIMIT', 'ASA_TEST_UID', 'ASA_TEST_GID', 'ASA_BLOCKS_RUNTIME_SIGNING_KEY')
  foreach ($name in ($managedNames | Select-Object -Unique)) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
  }
  $env:CI = 'true'
  $env:NX_SKIP_NX_CACHE = 'true'
  $env:NX_DAEMON = 'false'
  $env:ASA_BUILD_REVISION = $ExpectedRevision
  $env:ASA_IMAGE_TAG = $imageTag
  $env:COMPOSE_PROJECT_NAME = $project
  $env:COMPOSE_PARALLEL_LIMIT = '1'
  $env:ASA_TEST_UID = '1000'
  $env:ASA_TEST_GID = '1000'
  $env:ASA_BLOCKS_RUNTIME_SIGNING_KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'

  # Resource-only local fixtures are generated from this committed source.
  $buildkitConfig = Join-Path $evidence 'buildkitd.toml'
  [IO.File]::WriteAllText($buildkitConfig, "[worker.oci]`n  max-parallelism = 1`n", $utf8)
  $override = Join-Path $evidence 'compose.resources.yaml'
  $resourceYaml = @'
services:
  postgres:
    mem_limit: 384m
    memswap_limit: 384m
    cpus: 1.0
    restart: 'no'
  migration:
    mem_limit: 512m
    memswap_limit: 512m
    cpus: 1.0
  api:
    mem_limit: 512m
    memswap_limit: 512m
    cpus: 1.0
    restart: 'no'
  web:
    mem_limit: 128m
    memswap_limit: 128m
    cpus: 0.5
    restart: 'no'
  test-runner:
    mem_limit: 1536m
    memswap_limit: 1536m
    cpus: 2.0
'@
  # Keep generated screenshots away from tracked reference evidence in the clone.
  $artifactSource = (Join-Path $evidence 'artifacts').Replace('\', '/').Replace("'", "''")
  $reportSource = (Join-Path $evidence 'reports').Replace('\', '/').Replace("'", "''")
  $resourceYaml += @"

    volumes:
      - type: bind
        source: '$artifactSource'
        target: /workspace/e2e/artifacts
      - type: bind
        source: '$reportSource'
        target: /workspace/reports
"@
  [IO.File]::WriteAllText($override, ($resourceYaml + "`n"), $utf8)
  New-Item -ItemType Directory -Path (Join-Path $repo '.asa\diagnostics\store') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $evidence 'artifacts') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $evidence 'reports') -Force | Out-Null
  $compose = @('compose', '--parallel', '1', '-p', $project, '-f', 'compose.yaml', '-f', 'compose.test.yaml', '-f', '.github/compose.registry-ci.yaml', '-f', $override, '--profile', 'test')
  foreach ($resource in @(
    @{ Name = 'containers'; Arguments = @('ps', '-a', '--filter', "label=com.docker.compose.project=$project", '--format', '{{.ID}}') },
    @{ Name = 'networks'; Arguments = @('network', 'ls', '--filter', "label=com.docker.compose.project=$project", '--format', '{{.ID}}') },
    @{ Name = 'volumes'; Arguments = @('volume', 'ls', '--filter', "label=com.docker.compose.project=$project", '--format', '{{.Name}}') }
  )) {
    $existing = Invoke-Docker ('owned-project-guard-' + $resource.Name) $resource.Arguments
    if ($existing.Output.Trim()) { throw "The generated project namespace already contains $($resource.Name)." }
  }
  foreach ($imageName in @('asa-lab-api', 'asa-lab-web', 'asa-lab-test')) {
    $existing = Invoke-Docker ('image-guard-' + $imageName) @('image', 'ls', '--quiet', '--filter', "reference=$imageName`:$imageTag")
    if ($existing.Output.Trim()) { throw "Image $imageName`:$imageTag already exists; refusing to retag it." }
  }
  $null = Invoke-Docker 'compose-config' ($compose + @('config', '--format', 'json'))
  $null = Invoke-Docker 'builder-create' @('buildx', 'create', '--name', $builder, '--driver', 'docker-container', '--driver-opt', 'memory=2560m', '--driver-opt', 'memory-swap=2560m', '--driver-opt', 'cpu-period=100000', '--driver-opt', 'cpu-quota=200000', '--driver-opt', 'cpuset-cpus=0-1', '--driver-opt', 'default-load=true', '--driver-opt', 'restart-policy=no', '--buildkitd-config', $buildkitConfig, $dockerContext)
  $builderCreated = $true
  $null = Invoke-Docker 'builder-bootstrap' @('buildx', 'inspect', $builder, '--bootstrap')
  $builderContainer = 'buildx_buildkit_' + $builder + '0'
  $builderInfo = (Invoke-Docker 'builder-resource-proof' @('container', 'inspect', $builderContainer)).Output | ConvertFrom-Json
  if ($builderInfo[0].HostConfig.Memory -ne 2684354560 -or $builderInfo[0].HostConfig.MemorySwap -ne 2684354560 -or $builderInfo[0].HostConfig.CpuQuota -ne 200000) { throw 'Builder resource limits were not applied.' }
  $buildArguments = @('build', '--builder', $builder, '--build-arg', 'NODE_IMAGE=mirror.gcr.io/library/node@sha256:43aeff40f4afc22e83f7589a2f37e111cff5ca84529571f1c8415bcc5fcc21b2', '--build-arg', 'CADDY_IMAGE=mirror.gcr.io/library/caddy@sha256:d8c17a862962def15cde69863a3a463f25a2664942eafd7bdbf050e9c3116b83', '--build-arg', 'BUILDKIT_SYNTAX=mirror.gcr.io/docker/dockerfile@sha256:b5f3b260a9678e1d83d2fce86eeddf79420b79147eaba2a25986f47133d73720', 'migration', 'api', 'web', 'test-runner')
  $null = Invoke-Docker 'build-production-and-runner' ($compose + $buildArguments)
  $images = (Invoke-Docker 'source-image-identities' @('image', 'inspect', "asa-lab-api:$imageTag", "asa-lab-web:$imageTag", "asa-lab-test:$imageTag")).Output | ConvertFrom-Json
  foreach ($image in @($images)[0..1]) {
    if ($image.Config.Labels.'org.opencontainers.image.revision' -cne $ExpectedRevision) { throw 'Production image revision label does not match the checked-out source.' }
  }
  $report.images = @($images | ForEach-Object { [ordered]@{ id = $_.Id; tags = $_.RepoTags; created = $_.Created; architecture = $_.Architecture; os = $_.Os; labels = $_.Config.Labels } })
  Save-Report
  $null = Invoke-Docker 'builder-stop-before-runtime' @('buildx', 'stop', $builder)
  $null = Require-FreeMemory
  if (@(Get-NetTCPConnection -LocalPort 4612 -State Listen -ErrorAction SilentlyContinue).Count) { throw 'Port 4612 was occupied during the build; refusing to start Web.' }
  $composeStarted = $true
  $null = Invoke-Docker 'postgres-start' ($compose + @('up', '-d', '--wait', '--wait-timeout', '120', 'postgres'))
  $null = Invoke-Docker 'fresh-database-migrations' ($compose + @('run', '--rm', '--no-deps', 'migration'))
  $null = Invoke-Docker 'production-api-web-start' ($compose + @('up', '-d', '--wait', '--wait-timeout', '240', '--no-deps', 'api', 'web'))
  $ids = (Invoke-Docker 'owned-container-ids' ($compose + @('ps', '-a', '-q'))).Output.Trim() -split '\r?\n'
  $containers = (Invoke-Docker 'runtime-resource-proof' (@('container', 'inspect') + $ids)).Output | ConvertFrom-Json
  $report.ownedContainerLimits = @($containers | ForEach-Object { [ordered]@{ id = $_.Id; imageId = $_.Image; service = $_.Config.Labels.'com.docker.compose.service'; project = $_.Config.Labels.'com.docker.compose.project'; memoryBytes = $_.HostConfig.Memory; memorySwapBytes = $_.HostConfig.MemorySwap; nanoCpus = $_.HostConfig.NanoCpus } })
  foreach ($container in $report.ownedContainerLimits) {
    if ($container.project -cne $project -or $container.memoryBytes -le 0 -or $container.memoryBytes -ne $container.memorySwapBytes) { throw 'Unexpected runtime ownership or missing memory/swap bound.' }
  }
  $null = Invoke-Docker 'runner-versions' ($compose + @('run', '--rm', '--no-deps', 'test-runner', 'sh', '-c', 'test -w /workspace/reports && test -w /workspace/e2e/artifacts && node --version && corepack pnpm --version && corepack pnpm exec playwright --version'))
  $browser = Invoke-Docker 'browser-proof' ($compose + @('run', '--rm', '--no-deps', '--name', ($project + '-browser'), '-e', 'NX_SKIP_NX_CACHE=true', 'test-runner', 'node', 'tools/capacity/request-storm.mjs', 'browser')) -AllowFailure
  $report.browserExitCode = $browser.ExitCode
  if ($browser.ExitCode -ne 0) { throw "Browser proof failed with exit code $($browser.ExitCode)." }
  $null = Read-Native git @('diff', '--exit-code', 'HEAD', '--', '.')
  $report.trackedSourceCleanAfter = $true
  $report.success = $true
}
catch {
  $failure = $_.Exception.Message
  if (Get-Variable report -ErrorAction SilentlyContinue) { $report.error = $failure; $report.success = $false }
  Write-Host "Windows proof failed: $failure"
}
finally {
  if (Get-Variable report -ErrorAction SilentlyContinue) {
    if ($composeStarted) {
      foreach ($cleanupStep in @(
        @{ Name = 'final-owned-status'; Arguments = $compose + @('ps', '-a', '--format', 'json') },
        @{ Name = 'owned-containers-down-keep-volumes'; Arguments = $compose + @('down', '--timeout', '20') }
      )) {
        try {
          $result = Invoke-Docker $cleanupStep.Name $cleanupStep.Arguments -AllowFailure
          if ($result.ExitCode -ne 0) { $cleanupFailures.Add($cleanupStep.Name) }
        } catch { $cleanupFailures.Add($_.Exception.Message) }
      }
    }
    if ($builderCreated) {
      try {
        $result = Invoke-Docker 'owned-builder-remove-keep-state' @('buildx', 'rm', '--keep-state', $builder) -AllowFailure
        if ($result.ExitCode -ne 0) { $cleanupFailures.Add('owned-builder-remove-keep-state') }
      } catch { $cleanupFailures.Add($_.Exception.Message) }
    }
    try {
      $volumes = Invoke-Docker 'retained-owned-volumes' @('volume', 'ls', '--filter', "label=com.docker.compose.project=$project", '--format', '{{.Name}}') -AllowFailure
      if ($volumes.ExitCode -ne 0) { throw 'Could not record the retained owned volumes.' }
      $report.retainedVolumes = @($volumes.Output.Trim() -split '\r?\n' | Where-Object { $_ })
    } catch { $cleanupFailures.Add($_.Exception.Message) }
    if ($cleanupFailures.Count) { $report.success = $false }
    $report.completedAt = [DateTime]::UtcNow.ToString('o')
    Save-Report
    Write-Host ([ordered]@{ success = $report.success; revision = $ExpectedRevision; project = $project; evidence = $evidence; browserExitCode = $report.browserExitCode; cleanupFailures = @($cleanupFailures.ToArray()) } | ConvertTo-Json -Compress)
  }
  foreach ($name in $previousEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process') }
  Set-Location -LiteralPath $previousLocation
}
if ($failure -or $cleanupFailures.Count) { exit 1 }
