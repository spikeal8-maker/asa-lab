#Requires -Version 5.1
<#
.SYNOPSIS
    ASA Lab Windows/Docker quick install and guarded lifecycle actions.
.DESCRIPTION
    1Panel runs on Linux only. Windows uses Docker Desktop + ASA's canonical
    tools/asa_manager.py; no PostgreSQL/database password is committed to Git.
    Existing data are not removed. Uses the published immutable stable release.
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\tools\bootstrap\install-windows.ps1 -Action Install -Profile staging
#>
[CmdletBinding()]
param(
    [ValidateSet('Install','Doctor','Check','Update','Backup','VerifyBackup','RestoreCheck')]
    [string]$Action = 'Install',
    [ValidateSet('staging','production','dev')]
    [string]$Profile = 'staging',
    [string]$Root = '',
    [string]$BackupDirectory = '',
    [string]$OutputDirectory = '',
    [string]$RestoreDatabase = 'asalab_bootstrap_test'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "BLOCKED: $Message" }
}
function Run-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "BLOCKED: $Executable failed (exit=$LASTEXITCODE); existing data untouched"
    }
}
function Resolve-Python {
    $py = Get-Command 'py.exe' -ErrorAction SilentlyContinue
    if ($null -ne $py) {
        & $py.Source '-3' '-c' 'import sys; assert sys.version_info >= (3, 11)'
        if ($LASTEXITCODE -eq 0) { return @($py.Source, '-3') }
    }
    $python = Get-Command 'python.exe' -ErrorAction SilentlyContinue
    Assert ($null -ne $python) 'Python 3.11+ is required; install it from python.org'
    & $python.Source '-c' 'import sys; assert sys.version_info >= (3, 11)'
    Assert ($LASTEXITCODE -eq 0) 'Python 3.11+ is required'
    return @($python.Source)
}
function Invoke-Manager([string[]]$Commands) {
    $full = @()
    if ($script:Python.Length -gt 1) { $full = @($script:Python[1..($script:Python.Length - 1)]) }
    $full += @('tools/asa_manager.py')
    $full += $Commands
    Run-Checked $script:Python[0] $full
}

try {
    Assert ($env:OS -eq 'Windows_NT') 'Supported on Windows 10/11 with Docker Desktop Linux containers'
    if ([string]::IsNullOrWhiteSpace($Root)) {
        # The script normally lives at tools/bootstrap/install-windows.ps1.
        $Root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
    }
    $Root = [System.IO.Path]::GetFullPath($Root)
    $script:Python = @(Resolve-Python)
    if ($Action -eq 'Install' -and -not (Test-Path (Join-Path $Root '.git'))) {
        $git = Get-Command 'git.exe' -ErrorAction SilentlyContinue
        Assert ($null -ne $git) 'Install Git for Windows or clone ASA Lab manually'
        Assert (-not (Test-Path $Root) -or (@(Get-ChildItem -LiteralPath $Root -Force).Count -eq 0)) 'Installation directory must be new or empty'
        Run-Checked $git.Source @('clone', '--depth', '1', '--branch', 'main', 'https://github.com/spikeal8-maker/asa-lab.git', $Root)
    }
    Assert (Test-Path (Join-Path $Root 'tools/asa_manager.py')) 'ASA canonical manager is missing from the checkout'
    $docker = Get-Command 'docker.exe' -ErrorAction SilentlyContinue
    Assert ($null -ne $docker) 'Docker Desktop is required; install it and start Linux containers first'
    Run-Checked $docker.Source @('compose','version')
    Run-Checked $docker.Source @('version','--format','{{.Server.Version}}')
    $platform = (& $docker.Source 'info' '--format' '{{.OSType}}' 2>$null)
    Assert ($LASTEXITCODE -eq 0 -and $platform.Trim() -eq 'linux') 'Docker Desktop must be running in Linux containers mode'
    Push-Location $Root
    try {
        $releaseMarker = Join-Path $Root '.asa/installed-release.json'
        switch ($Action) {
            'Install' {
                if (Test-Path $releaseMarker) { Invoke-Manager @('doctor','--profile',$Profile) }
                else {
                    Assert (-not (Test-Path (Join-Path $Root '.env'))) 'Unconfirmed existing .env detected without release marker; inspect it before new installation'
                    Invoke-Manager @('install','--profile',$Profile)
                }
            }
            'Doctor' { Invoke-Manager @('doctor','--profile',$Profile) }
            'Check' { Invoke-Manager @('check','--profile',$Profile) }
            'Update' { Invoke-Manager @('update','--profile',$Profile) }
            'Backup' {
                $params = @('backup','--profile',$Profile)
                if ($OutputDirectory) { $params += @('--output',$OutputDirectory) }
                Invoke-Manager $params
            }
            'VerifyBackup' {
                Assert ([bool]$BackupDirectory) '-BackupDirectory is required'
                Invoke-Manager @('verify-backup','--backup',$BackupDirectory)
            }
            'RestoreCheck' {
                Assert ([bool]$BackupDirectory) '-BackupDirectory is required'
                Assert ($RestoreDatabase -match '^[A-Za-z_][A-Za-z0-9_]{0,50}_test$') 'Restore database must end in _test'
                Invoke-Manager @('restore-check','--profile',$Profile,'--backup',$BackupDirectory,'--database',$RestoreDatabase)
            }
        }
    } finally { Pop-Location }
    Write-Host "PASS action=$Action root=$Root profile=$Profile"
} catch {
    Write-Error $_.Exception.Message
    exit 2
}