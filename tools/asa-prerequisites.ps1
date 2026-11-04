# ASA Lab WIN-02A: Windows prerequisite preflight and explicit Git/Python provisioning.
# No Docker/WSL installation, Windows feature/adapter/firewall/DNS/VPN changes, or reboot.
[CmdletBinding()]
param(
  [switch]$Apply,
  [switch]$ConfirmWingetTools
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Say([string]$State, [string]$Message) {
  $color = switch ($State) {
    'PASS' { 'Green' }
    'WARN' { 'Yellow' }
    'BLOCKED' { 'Red' }
    default { 'Cyan' }
  }
  Write-Host ("[{0}] {1}" -f $State, $Message) -ForegroundColor $color
}
function Find-Executable([string]$Name) {
  # Windows may expose both the real executable AND a Store App Execution
  # Alias with the same name. Never stringify their Source properties together.
  foreach ($cmd in @(Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue)) {
    if (-not $cmd) { continue }
    $candidate = [string]$cmd.Source
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return $candidate
    }
  }
  return $null
}
function Test-Git {
  $exe = Find-Executable 'git.exe'
  if (-not $exe) { return $false }
  try {
    & $exe --version 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}
function Test-Python {
  foreach ($entry in @(
    @{ Name = 'python.exe'; Args = @() },
    @{ Name = 'py.exe'; Args = @('-3') }
  )) {
    $exe = Find-Executable $entry.Name
    if (-not $exe) { continue }
    try {
      $answer = (& $exe @($entry.Args) -c 'import sys; print(311013 if sys.version_info >= (3, 11) else 0); raise SystemExit(0 if sys.version_info >= (3, 11) else 2)' 2>$null | Out-String).Trim()
      # The numeric sentinel avoids nested quote loss in Windows PowerShell 5.1.
      # A shim that swallows exit codes without launching Python is NOT valid.
      if ($LASTEXITCODE -eq 0 -and $answer -ceq '311013') { return $true }
    } catch {
      # Windows Store aliases and broken interpreter launchers are not valid Python.
    }
  }
  return $false
}
function Test-Docker {
  $exe = Find-Executable 'docker.exe'
  if (-not $exe) { return @{ State = 'MISSING'; Detail = 'Docker executable is absent' } }
  try {
    $server = (& $exe info --format '{{.OSType}}/{{.Architecture}}' 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
      return @{ State = 'NOT_RUNNING'; Detail = 'Docker Desktop engine is not running; start it manually' }
    }
    if ($server -cnotin @('linux/amd64', 'linux/x86_64')) {
      return @{ State = 'PLATFORM'; Detail = ('Docker Linux/amd64 required; found ' + $server) }
    }
    $osName = (& $exe info --format '{{.OperatingSystem}}' 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $osName -notmatch 'Docker Desktop') {
      return @{ State = 'NOT_DESKTOP'; Detail = ('Expected Docker Desktop, found ' + $osName) }
    }
    & $exe compose version 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
      return @{ State = 'COMPOSE'; Detail = 'Docker Compose v2 is not available' }
    }
    return @{ State = 'READY'; Detail = ('Docker/Compose ' + $server) }
  } catch {
    return @{ State = 'NOT_RUNNING'; Detail = 'Docker Desktop not ready; do not change WSL or Windows features automatically' }
  }
}
function Trusted-Winget {
  # Restrict package-manager execution to the Microsoft Store App Installer
  # app-execution alias. A random executable earlier in PATH is not trusted.
  $exe = Find-Executable 'winget.exe'
  if (-not $exe) { return $null }
  $expected = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\winget.exe'))
  if (-not [IO.Path]::GetFullPath($exe).Equals($expected, [StringComparison]::OrdinalIgnoreCase)) {
    Say BLOCKED ('WINGET_UNTRUSTED_PATH: refusing executable outside official App Installer alias: ' + $exe)
    exit 2
  }
  try {
    $info = Get-Item -LiteralPath $exe -Force -ErrorAction Stop
    if (($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
      Say BLOCKED 'WINGET_ALIAS_INVALID: expected Microsoft App Installer app execution alias.'
      exit 2
    }
    $package = Get-AppxPackage -Name Microsoft.DesktopAppInstaller -ErrorAction Stop
    if (-not $package -or $package.PublisherId -cne '8wekyb3d8bbwe' -or
        [string]$package.SignatureKind -cne 'Store') {
      Say BLOCKED 'WINGET_PUBLISHER: Microsoft Store-signed DesktopAppInstaller package is not verified.'
      exit 2
    }
  } catch {
    Say BLOCKED 'WINGET_PUBLISHER: unable to attest installed Microsoft DesktopAppInstaller package.'
    exit 2
  }
  return $exe
}

function Install-Package([string]$Id, [string]$Winget) {
  # Exact IDs and public default winget source; no remote scripts/pipes.
  Say INFO ('Installing explicitly authorized Windows prerequisite: ' + $Id)
  & $Winget install --id $Id --exact --source winget --silent --disable-interactivity --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    Say BLOCKED ("WINGET_FAILED id=$Id exit=$LASTEXITCODE. Inspect package manager output; no cleanup/reset.")
    exit 3
  }
  Say PASS ('Installer returned success for ' + $Id + '; verify it in a new terminal.')
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  Say BLOCKED 'WINDOWS_ONLY: run on Windows 10/11 x64'
  exit 2
}
$gitOk = Test-Git
$pythonOk = Test-Python
$docker = Test-Docker
if ($gitOk) { Say PASS 'Git for Windows is available' }
else { Say WARN 'GIT_REQUIRED: Git.Git' }
if ($pythonOk) { Say PASS 'Python 3.11+ is available' }
else { Say WARN 'PYTHON_REQUIRED: Python.Python.3.13' }
if ($docker.State -eq 'READY') { Say PASS $docker.Detail }
else { Say WARN ("DOCKER_$($docker.State): $($docker.Detail)") }

$missingTools = @()
if (-not $gitOk) { $missingTools += 'Git.Git' }
if (-not $pythonOk) { $missingTools += 'Python.Python.3.13' }

if (-not $Apply) {
  if ($missingTools.Count -gt 0) {
    Say INFO ('PLAN_ONLY: would offer winget packages ' + ($missingTools -join ', '))
  }
  if ($docker.State -ne 'READY') {
    Say WARN 'Docker Desktop must be installed/started and Linux/amd64/Compose configured manually. No WSL/Windows/network changes.'
  }
  Say INFO 'PLAN_ONLY: host packages, services, settings and containers were not changed.'
  if ($missingTools.Count -eq 0 -and $docker.State -eq 'READY') {
    Say PASS 'WIN02_READY'
    exit 0
  }
  Say BLOCKED 'WIN02_NOT_READY: address listed prerequisites; re-run the same command'
  exit 2
}

if ($missingTools.Count -gt 0 -and -not $ConfirmWingetTools) {
  Say BLOCKED 'EXPLICIT_CONSENT_REQUIRED: installing Git/Python requires both -Apply and -ConfirmWingetTools; no package was installed'
  exit 2
}
if ($missingTools.Count -gt 0) {
  $winget = Trusted-Winget
  if (-not $winget) {
    Say BLOCKED 'WINGET_REQUIRED: App Installer/winget is missing. Install it manually; no Microsoft Store action performed.'
    exit 2
  }
  # This is the only execution point that may install a host package.
  foreach ($package in $missingTools) { Install-Package $package $winget }
  Say WARN 'NEW_SHELL_REQUIRED: open a new PowerShell after installing Git/Python, then re-check prerequisites.'
  exit 2
}
if ($docker.State -ne 'READY') {
  Say BLOCKED 'DOCKER_MANUAL: Docker Desktop may require WSL/network/virtualization changes; this script never installs or starts it.'
  exit 2
}
Say PASS 'WIN02_READY: run the independently verified ASA Lab Bootstrap'
exit 0
