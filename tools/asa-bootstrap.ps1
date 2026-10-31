# ASA Lab Windows bootstrap v1.0.0. The persistent launcher is outside the app checkout.
# No remote code execution, host changes, WSL/Docker installation or automatic source updates.
[CmdletBinding()]
param(
  [switch]$InstallBootstrap,
  [string]$ExpectedCommit,
  [string]$InstallerHome = (Join-Path $env:LOCALAPPDATA 'ASA-Lab\Installer'),
  [switch]$ShowVersion,
  [string]$Root,
  [ValidateSet('auto','clean','update')][string]$Mode,
  [ValidateSet('blank','backup')][string]$DataSource,
  [string]$BackupPath,
  [string]$Project,
  [int]$WebPort,
  [int]$BlocksPort,
  [string]$NetworkCidrs,
  [switch]$ConfirmPrivateDockerNetworks,
  [ValidateSet('dev','production','staging')][string]$Profile,
  [switch]$Apply,
  [switch]$ConfirmBlankDatabase,
  [switch]$ConfirmBackupSelection
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$BootstrapVersion = '1.0.0'
$Canonical = 'https://github.com/spikeal8-maker/asa-lab.git'
$script:CallerParameters = @{}
foreach ($item in $PSBoundParameters.GetEnumerator()) { $script:CallerParameters[$item.Key] = $item.Value }

function Block([string]$Code, [string]$Detail) {
  Write-Host ('[BLOCKED] {0}: {1}' -f $Code, $Detail) -ForegroundColor Red
  throw $Code
}
function Assert-NotReparse([string]$Path) {
  $item = [IO.Path]::GetFullPath($Path)
  while ($item) {
    if (Test-Path -LiteralPath $item) {
      $info = Get-Item -LiteralPath $item -Force
      if (($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        Block 'REPARSE_PATH' ('Refusing to traverse a junction or symbolic link: ' + $item)
      }
    }
    $parent = Split-Path -Parent $item
    if (-not $parent -or $parent -eq $item) { break }
    $item = $parent
  }
}
function Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Write-JsonFile([string]$Path, [object]$Value) {
  $json = ConvertTo-Json -InputObject $Value -Depth 8 -Compress
  [IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))
}
function Package-Paths([string]$SourceTools) {
  $required = @('asa-setup.ps1', 'asa_manager.py')
  foreach ($relative in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $SourceTools $relative) -PathType Leaf)) {
      Block 'SOURCE_INCOMPLETE' ('Missing installer component: ' + $relative)
    }
  }
  $deployment = Join-Path $SourceTools 'deployment'
  if (-not (Test-Path -LiteralPath (Join-Path $deployment '__init__.py') -PathType Leaf)) {
    Block 'SOURCE_INCOMPLETE' 'Python deployment package is missing.'
  }
  $files = @($required)
  $modules = @(Get-ChildItem -LiteralPath $deployment -File -Filter '*.py' -Recurse |
    Where-Object { $_.Name -notlike 'test_*' } | Sort-Object -Property FullName)
  foreach ($module in $modules) {
    Assert-NotReparse $module.FullName
    $relative = $module.FullName.Substring($SourceTools.TrimEnd('\').Length + 1).Replace('\','/')
    if ($relative -match '(^|/)\.\.?(/|$)') { Block 'UNSAFE_PATH' 'Invalid package path.' }
    $files += $relative
  }
  return @($files | Sort-Object -Unique)
}
function Verify-Package([string]$PackageDir, [string]$ManifestSha, [string]$Commit) {
  Assert-NotReparse $PackageDir
  $manifestPath = Join-Path $PackageDir 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    Block 'PACKAGE_MISSING' 'The installer manifest is absent.'
  }
  if ((Sha256 $manifestPath) -cne $ManifestSha) {
    Block 'MANIFEST_HASH' 'The installer manifest changed after activation.'
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.format -cne 'asa-windows-installer-v1' -or
      $manifest.sourceCommit -cne $Commit -or
      $manifest.bootstrapVersion -cne $BootstrapVersion) {
    Block 'MANIFEST_IDENTITY' 'Installer version or source commit does not match the receipt.'
  }
  $entries = @($manifest.files.PSObject.Properties)
  if ($entries.Count -lt 3) { Block 'MANIFEST_EMPTY' 'Required installer files are missing.' }
  $names = @($entries | ForEach-Object { $_.Name })
  foreach ($required in @('asa-setup.ps1','asa_manager.py','deployment/__init__.py')) {
    if ($required -cnotin $names) { Block 'MANIFEST_INCOMPLETE' ('Missing ' + $required) }
  }
  foreach ($entry in $entries) {
    $name = [string]$entry.Name
    if ($name -notmatch '^(?:asa-setup\.ps1|asa_manager\.py|deployment/[a-zA-Z0-9_./-]+\.py)$' -or
        $name -match '(^|/)\.\.?(/|$)') {
      Block 'MANIFEST_PATH' 'The package manifest contains an unsafe file path.'
    }
    $file = Join-Path $PackageDir ($name.Replace('/','\'))
    Assert-NotReparse $file
    if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or
        (Sha256 $file) -cne ([string]$entry.Value)) {
      Block 'PACKAGE_HASH' ('Installer file is missing or modified: ' + $name)
    }
  }
  return $manifest
}
function Activate-Package([string]$StagingHome, [string]$Commit, [string]$ManifestSha) {
  $receipt = [ordered]@{
    format = 'asa-windows-bootstrap-active-v1'
    bootstrapVersion = $BootstrapVersion
    sourceCommit = $Commit
    manifestSha256 = $ManifestSha
  }
  $active = Join-Path $StagingHome 'active.json'
  $temporary = Join-Path $StagingHome ('active.' + [guid]::NewGuid().ToString('N') + '.pending')
  Write-JsonFile $temporary $receipt
  try {
    if (Test-Path -LiteralPath $active) {
      $existing = Get-Content -LiteralPath $active -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($existing.sourceCommit -ceq $Commit -and $existing.manifestSha256 -ceq $ManifestSha) {
        Write-Host '[PASS] NO_CHANGE: installer package is already active.' -ForegroundColor Green
        return
      }
      $previous = Join-Path $StagingHome ('previous-' + [guid]::NewGuid().ToString('N') + '.json')
      [IO.File]::Replace($temporary, $active, $previous)
    } else {
      Move-Item -LiteralPath $temporary -Destination $active -ErrorAction Stop
    }
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}
function Stage-Bootstrap([string]$StagingHome) {
  if ($ExpectedCommit -notmatch '^[0-9a-fA-F]{40}$') {
    Block 'EXPECTED_COMMIT_REQUIRED' 'Supply the independently verified full 40-character Git commit SHA.'
  }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Block 'GIT_REQUIRED' 'Staging from a checked-out official source requires Git; no host changes are made.'
  }
  $sourceTools = [IO.Path]::GetFullPath($PSScriptRoot)
  $repoRoot = Split-Path -Parent $sourceTools
  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.git'))) {
    Block 'SOURCE_REPOSITORY' 'Installer staging requires an official Git checkout, not arbitrary downloaded scripts.'
  }
  Assert-NotReparse $repoRoot
  $origin = (& git -C $repoRoot remote get-url origin | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $origin -cnotin @(
    $Canonical, 'https://github.com/spikeal8-maker/asa-lab', 'git@github.com:spikeal8-maker/asa-lab.git')) {
    Block 'SOURCE_ORIGIN' 'Installer source does not point to the official repository.'
  }
  $revision = (& git -C $repoRoot rev-parse HEAD | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $revision -cne $ExpectedCommit.ToLowerInvariant()) {
    Block 'SOURCE_SHA' 'The exact checkout SHA differs from the independently supplied SHA.'
  }
  $changes = (& git -C $repoRoot status --porcelain --untracked-files=all | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $changes) {
    Block 'SOURCE_DIRTY' 'Installer source is modified or has untracked files; staging is refused.'
  }
  $names = @(Package-Paths $sourceTools)
  if ($names.Count -lt 3) { Block 'SOURCE_INCOMPLETE' 'No deployment modules were found.' }
  $packages = Join-Path $StagingHome 'packages'
  New-Item -ItemType Directory -Path $packages -Force | Out-Null
  $final = Join-Path $packages $revision
  if (Test-Path -LiteralPath $final) {
    $existingManifest = Join-Path $final 'manifest.json'
    if (-not (Test-Path -LiteralPath $existingManifest -PathType Leaf)) {
      Block 'PACKAGE_COLLISION' 'Existing package is incomplete; nothing will be overwritten.'
    }
    $manifestHash = Sha256 $existingManifest
    $verified = Verify-Package $final $manifestHash $revision
    $storedNames = @($verified.files.PSObject.Properties | ForEach-Object { $_.Name } | Sort-Object)
    if (($storedNames -join '|') -cne ($names -join '|')) {
      Block 'PACKAGE_SOURCE_MISMATCH' 'The existing package file set differs from the trusted source checkout.'
    }
    foreach ($relative in $names) {
      $original = Join-Path $sourceTools ($relative.Replace('/','\'))
      if ((Sha256 $original) -cne ([string]$verified.files.PSObject.Properties[$relative].Value)) {
        Block 'PACKAGE_SOURCE_MISMATCH' ('Existing package differs from the trusted source: ' + $relative)
      }
    }
  } else {
    $pending = Join-Path $packages ('.pending-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $pending -ErrorAction Stop | Out-Null
    try {
      $hashes = [ordered]@{}
      foreach ($relative in $names) {
        $from = Join-Path $sourceTools ($relative.Replace('/','\'))
        Assert-NotReparse $from
        $to = Join-Path $pending ($relative.Replace('/','\'))
        $parent = Split-Path -Parent $to
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
        Copy-Item -LiteralPath $from -Destination $to -ErrorAction Stop
        $hashes[$relative] = Sha256 $to
      }
      Write-JsonFile (Join-Path $pending 'manifest.json') ([ordered]@{
        format = 'asa-windows-installer-v1'
        bootstrapVersion = $BootstrapVersion
        sourceCommit = $revision
        files = $hashes
      })
      $manifestHash = Sha256 (Join-Path $pending 'manifest.json')
      $null = Verify-Package $pending $manifestHash $revision
      if (Test-Path -LiteralPath $final) {
        Block 'PACKAGE_COLLISION' 'The target package was created concurrently; existing data is retained.'
      }
      Move-Item -LiteralPath $pending -Destination $final -ErrorAction Stop
    } finally {
      if (Test-Path -LiteralPath $pending) {
        Remove-Item -LiteralPath $pending -Recurse -Force
      }
    }
  }
  $launcher = Join-Path $StagingHome 'asa-bootstrap.ps1'
  if (Test-Path -LiteralPath $launcher) {
    if ((Sha256 $launcher) -cne (Sha256 $PSCommandPath)) {
      Block 'LAUNCHER_UPDATE_BLOCKED' 'Launcher replacement requires separately verified distribution. Existing launcher was preserved.'
    }
  } else {
    Copy-Item -LiteralPath $PSCommandPath -Destination $launcher -ErrorAction Stop
  }
  Activate-Package $StagingHome $revision $manifestHash
  Write-Host ('[PASS] Installer ' + $BootstrapVersion + ' staged outside ASA checkout: ' + $StagingHome) -ForegroundColor Green
  Write-Host ('[PASS] Verified source commit: ' + $revision) -ForegroundColor Green
  return $launcher
}
function Forward-Setup([string]$SetupPath, [switch]$PassInstallerHome) {
  $forward = @{}
  foreach ($key in @('Root','Mode','DataSource','BackupPath','Project','WebPort','BlocksPort',
    'NetworkCidrs','ConfirmPrivateDockerNetworks','Profile','Apply','ConfirmBlankDatabase',
    'ConfirmBackupSelection')) {
    if ($script:CallerParameters.ContainsKey($key)) { $forward[$key] = $script:CallerParameters[$key] }
  }
  if (-not $Root) { Block 'ROOT_REQUIRED' 'Specify -Root with the new or existing ASA Lab installation directory.' }
  if ($PassInstallerHome) { $forward['InstallerHome'] = $homePath }
  & $SetupPath @forward
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$homePath = [IO.Path]::GetFullPath($InstallerHome)
Assert-NotReparse $homePath
if ($Root) {
  $appPath = [IO.Path]::GetFullPath($Root)
  $homePrefix = $homePath.TrimEnd('\') + '\'
  $appPrefix = $appPath.TrimEnd('\') + '\'
  if ($homePath.Equals($appPath, [StringComparison]::OrdinalIgnoreCase) -or
      $homePath.StartsWith($appPrefix, [StringComparison]::OrdinalIgnoreCase) -or
      $appPath.StartsWith($homePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    Block 'BOOTSTRAP_LOCATION' 'InstallerHome must be independent of the application root.'
  }
}
if ($InstallBootstrap) {
  $sourceParent = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
  if ($homePath.Equals($sourceParent, [StringComparison]::OrdinalIgnoreCase) -or
      $homePath.StartsWith($sourceParent.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    Block 'BOOTSTRAP_LOCATION' 'The persistent installer may not be staged inside its source checkout.'
  }
  New-Item -ItemType Directory -Path $homePath -Force | Out-Null
  $launcher = Stage-Bootstrap $homePath
  if ($Root) {
    Forward-Setup $launcher -PassInstallerHome
  }
  return
}
$activePath = Join-Path $homePath 'active.json'
if (-not (Test-Path -LiteralPath $activePath -PathType Leaf)) {
  Block 'BOOTSTRAP_NOT_STAGED' 'First stage a verified installer from the canonical source checkout.'
}
$active = Get-Content -LiteralPath $activePath -Encoding UTF8 -Raw | ConvertFrom-Json
if ($active.format -cne 'asa-windows-bootstrap-active-v1' -or
    $active.bootstrapVersion -cne $BootstrapVersion -or
    ([string]$active.sourceCommit) -notmatch '^[0-9a-f]{40}$' -or
    ([string]$active.manifestSha256) -notmatch '^[0-9a-f]{64}$') {
  Block 'ACTIVE_RECEIPT_INVALID' 'Persistent installer receipt has an invalid version or identity.'
}
$package = Join-Path (Join-Path $homePath 'packages') ([string]$active.sourceCommit)
$manifest = Verify-Package $package ([string]$active.manifestSha256) ([string]$active.sourceCommit)
Write-Host ('[PASS] Bootstrap ' + $BootstrapVersion + ', installer SHA ' + $manifest.sourceCommit) -ForegroundColor Green
if ($ShowVersion) { return }
Forward-Setup (Join-Path $package 'asa-setup.ps1')
