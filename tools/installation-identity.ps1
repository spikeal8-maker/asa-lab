# Read-only guard shared by startup and updater; no containers or credentials are changed.
function ConvertTo-AsaIdentityPath {
  param([string]$Value)
  $value = $Value.Replace('\', '/').TrimEnd('/')
  if ($env:OS -eq 'Windows_NT') { return $value.ToLowerInvariant() }
  return $value
}

function Assert-AsaIdentityInventory {
  param([string]$Root, [string]$Project, [string[]]$Files, [object[]]$Records,
    [bool]$EnvironmentExists, [bool]$RequireExisting = $false)
  $rootKey = ConvertTo-AsaIdentityPath $Root
  $expectedFiles = (@($Files | ForEach-Object { ConvertTo-AsaIdentityPath $_ }) -join ',')
  $owned = @{}
  $foreignAsa = @()
  foreach ($r in $Records) {
    if ($r.Service -notin @('postgres', 'api', 'web', 'scratch')) { continue }
    $sameRoot = $r.Root -and (ConvertTo-AsaIdentityPath $r.Root) -ceq $rootKey
    if ($r.Project -cne $Project) {
      if ($sameRoot) { throw "ASA_IDENTITY_PROJECT: $($r.Name) already belongs to $($r.Project) in this directory." }
      if ($r.Project -match '^asa-lab($|[-_])' -or $r.Image -match '(^|/)(asa-lab-(api|web|scratch))([:@]|$)') { $foreignAsa += $r.Name }
      continue
    }
    if (-not $EnvironmentExists) { throw 'ASA_IDENTITY_ENV: existing installation has no .env; never regenerate its secrets.' }
    if (-not $sameRoot) { throw "ASA_IDENTITY_ROOT: $($r.Name) has a different or missing deployment root. Use the existing installation." }
    $actualFiles = ConvertTo-AsaIdentityPath $r.Files
    if ($actualFiles -cne $expectedFiles) { throw "ASA_IDENTITY_FILES: $($r.Name) has different/missing Compose files; preserve its overlays." }
    if ($owned.ContainsKey($r.Service)) { throw "ASA_IDENTITY_DUPLICATE: multiple $($r.Service) containers in $Project; inspect, do not pick one." }
    $owned[$r.Service] = $r.Name
  }
  if ($owned.Count -eq 0 -and ($RequireExisting -or $foreignAsa.Count -gt 0)) {
    throw "ASA_IDENTITY_EXISTING: do not create another ASA installation; existing services: $($foreignAsa -join ', ')."
  }
}

function Assert-AsaInstallationIdentity {
  param([Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$DefaultProject,
    [Parameter(Mandatory = $true)][string[]]$ComposeArguments,
    [switch]$RequireExisting)
  $environmentFile = Join-Path $Root '.env'
  $exists = Test-Path -LiteralPath $environmentFile
  $project = $DefaultProject
  if ($exists) {
    $line = @(Get-Content -LiteralPath $environmentFile -Encoding UTF8 |
      Where-Object { $_ -match '^COMPOSE_PROJECT_NAME=' } | Select-Object -Last 1)
    if ($line.Count -ne 1) { throw 'ASA_IDENTITY_ENV: .env must identify COMPOSE_PROJECT_NAME.' }
    $project = ($line[0] -split '=', 2)[1].Trim()
  }
  if ($project -cnotmatch '^[a-z0-9][a-z0-9_-]*$') { throw 'ASA_IDENTITY_PROJECT: invalid project name.' }
  if ($env:COMPOSE_PROJECT_NAME -and $env:COMPOSE_PROJECT_NAME -cne $project) {
    throw 'ASA_IDENTITY_PROJECT: process project differs from the selected .env/default.'
  }
  $files = @()
  for ($i = 0; $i -lt $ComposeArguments.Count; $i++) {
    if ($ComposeArguments[$i] -eq '-f') {
      $i++
      if ($i -ge $ComposeArguments.Count) { throw 'ASA_IDENTITY_FILES: missing Compose file.' }
      $file = $ComposeArguments[$i]
      if (-not [IO.Path]::IsPathRooted($file)) { $file = Join-Path $Root $file }
      $files += [IO.Path]::GetFullPath($file)
    }
  }
  if ($files.Count -eq 0) { throw 'ASA_IDENTITY_FILES: no explicit Compose files.' }
  $ids = @(& docker ps -aq --filter 'label=com.docker.compose.project')
  if ($LASTEXITCODE -ne 0) { throw 'ASA_IDENTITY_DOCKER: cannot list containers; no mutation allowed.' }
  $records = @()
  if ($ids.Count -gt 0) {
    # Only metadata. Never read/print container environment or credentials.
    $template = '[{{json .Name}},{{json .Config.Image}},{{json .Config.Labels}}]'
    $lines = @(& docker inspect --format $template @ids)
    if ($LASTEXITCODE -ne 0) { throw 'ASA_IDENTITY_DOCKER: cannot inspect containers; no mutation allowed.' }
    foreach ($line in $lines) {
      $row = ConvertFrom-Json -InputObject $line
      if ($row.Count -ne 3) { throw 'ASA_IDENTITY_DOCKER: malformed inspection.' }
      $labels = @{}
      if ($row[2]) { foreach ($property in $row[2].PSObject.Properties) { $labels[$property.Name] = $property.Value } }
      $records += [pscustomobject]@{
        Name = [string]$row[0]; Image = [string]$row[1]
        Project = [string]$labels['com.docker.compose.project']
        Service = [string]$labels['com.docker.compose.service']
        Root = [string]$labels['com.docker.compose.project.working_dir']
        Files = [string]$labels['com.docker.compose.project.config_files']
      }
    }
  }
  Assert-AsaIdentityInventory -Root $Root -Project $project -Files $files -Records $records `
    -EnvironmentExists $exists -RequireExisting $RequireExisting.IsPresent
  Write-Host "ASA_IDENTITY_OK: project=$project; existing root and Compose files verified."
}
