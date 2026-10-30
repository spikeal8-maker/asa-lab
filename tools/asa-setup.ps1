# ASA Lab unified Windows setup. Never alters Windows network/WSL/firewall.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Root,
  [ValidateSet('auto','clean','update')][string]$Mode='auto',
  [ValidateSet('blank','backup')][string]$DataSource='blank',
  [string]$BackupPath,
  [string]$Project='asa-lab-install',
  [int]$WebPort=4610,
  [int]$BlocksPort=4613,
  [string]$NetworkCidrs,
  [switch]$ConfirmPrivateDockerNetworks,
  [ValidateSet('dev','production','staging')][string]$Profile='production',
  [switch]$Apply,
  [switch]$ConfirmBlankDatabase,
  [switch]$ConfirmBackupSelection
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$Canonical='https://github.com/spikeal8-maker/asa-lab.git'
function Say([string]$state,[string]$text) {
  $c=switch($state){'PASS'{'Green'} 'WARN'{'Yellow'} 'BLOCKED'{'Red'} default{'Cyan'}}
  Write-Host ('[{0}] {1}' -f $state,$text) -ForegroundColor $c
}
function Fail([string]$code,[string]$why) {
  Say BLOCKED ($code+': '+$why)
  throw $code
}
function Select-Python {
  foreach($name in @('python','py')) {
    $cmd=Get-Command $name -ErrorAction SilentlyContinue
    if(-not $cmd){continue}
    if($name -eq 'py'){$prefix=@('-3')}else{$prefix=@()}
    & $cmd.Source @prefix -c 'import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 5)' 2>$null
    if($LASTEXITCODE -eq 0){return ,@($cmd.Source)+$prefix}
  }
  return $null
}
function Check-Host {
  Say INFO 'Checking Git, Python 3.11+, Docker Desktop, Compose (no changes)'
  if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){Fail WINDOWS_ONLY 'This entry point requires Windows.'}
  if(-not (Get-Command git -ErrorAction SilentlyContinue)){
    Fail GIT_REQUIRED 'Install Git for Windows; optional command: winget install Git.Git'
  }
  Say PASS 'Git is available'
  $script:Python=@(Select-Python)
  if(-not $script:Python -or -not $script:Python[0]){
    Fail PYTHON_REQUIRED 'Install Python 3.11+; optional command: winget install Python.Python.3.13'
  }
  Say PASS 'Python 3.11+ runtime is available'
  if(-not (Get-Command docker -ErrorAction SilentlyContinue)){
    Fail DOCKER_REQUIRED 'Install Docker Desktop with WSL2 Linux containers. Suggested: winget install Docker.DockerDesktop'
  }
  $engine=(& docker info --format '{{.OSType}}/{{.Architecture}}' 2>$null | Out-String).Trim()
  if($LASTEXITCODE -ne 0){Fail DOCKER_NOT_RUNNING 'Start Docker Desktop Linux engine yourself; no system changes are made.'}
  if($engine -notin @('linux/amd64','linux/x86_64')){
    Fail DOCKER_PLATFORM ('Expected Linux amd64 Docker, received '+$engine)
  }
  & docker compose version *> $null
  if($LASTEXITCODE -ne 0){Fail COMPOSE_REQUIRED 'Docker Compose v2 unavailable.'}
  Say PASS ('Docker Desktop Linux/Compose ready: '+$engine)
}
function Confirm-Selection([string]$question,[bool]$confirmed) {
  if($confirmed){return}
  if([Console]::IsInputRedirected){Fail CONFIRM_REQUIRED ('Provide explicit confirmation flag: '+$question)}
  $answer=Read-Host ($question+' (enter INSTALL)')
  if($answer -cne 'INSTALL'){Fail CONFIRM_REQUIRED 'The operator cancelled the installation.'}
}
function Invoke-Manager([string]$action,[string[]]$opts) {
  # The trusted setup script may live outside the target checkout. Keep its
  # installer manager stable if target source advances to a published release.
  $scriptFile=Join-Path $PSScriptRoot 'asa_manager.py'
  if(-not (Test-Path $scriptFile)){$scriptFile=Join-Path $script:TargetRoot 'tools\asa_manager.py'}
  if(-not (Test-Path $scriptFile)){Fail MANAGER_MISSING 'ASA manager missing in the selected root.'}
  $exe=$script:Python[0]
  $pyArgs=@()
  if($script:Python.Count -gt 1){$pyArgs+=@($script:Python[1])}
  $command=@($scriptFile,$action,'--root',$script:TargetRoot,'--profile',$Profile)+$opts
  for($i=1;$i -le 2;$i++){
    # After RETRY_NEW_MANAGER private .env already stores explicit project/ports.
    # Older published managers may not recognize fresh-install flag names.
    if($i -eq 2 -and $action -eq 'install' -and (Test-Path (Join-Path $script:TargetRoot '.env'))){
      $command=@($scriptFile,$action,'--root',$script:TargetRoot,'--profile',$Profile)
    }
    Say INFO ('Running '+$action+', attempt '+$i)
    # PowerShell 5 treats a native tool's stderr as ErrorRecord. With
    # ErrorActionPreference=Stop that would abort before we can inspect the
    # numeric exit code and handle the documented RETRY_NEW_MANAGER barrier.
    $previousErrorAction=$ErrorActionPreference
    try{
      $ErrorActionPreference='Continue'
      $lines=@(& $exe @pyArgs @command 2>&1 | ForEach-Object {
        $text=[string]$_
        Write-Host $text
        $text
      })
      $code=$LASTEXITCODE
    }finally{
      $ErrorActionPreference=$previousErrorAction
    }
    if($code -eq 0){return}
    if($i -eq 1 -and ($lines -join [Environment]::NewLine) -match 'BLOCKED RETRY_NEW_MANAGER:'){
      Say WARN 'Verified published manager was selected; retrying only once'
      continue
    }
    Fail ASA_MANAGER_BLOCKED ('Exit '+$code+'. Preserve the project and inspect its printed safe action.')
  }
}
$TargetRoot=[IO.Path]::GetFullPath($Root)
Say INFO ('ASA Lab Windows setup: '+$TargetRoot)
Check-Host
$exists=Test-Path $TargetRoot
$installed=$false
if($exists){
  if(-not (Test-Path (Join-Path $TargetRoot '.git'))){
    Fail ROOT_NOT_REPOSITORY 'This directory exists but is not an ASA checkout. No overwrite is allowed.'
  }
  $remote=(& git -C $TargetRoot remote get-url origin 2>$null | Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or $remote -notin @($Canonical,'https://github.com/spikeal8-maker/asa-lab','git@github.com:spikeal8-maker/asa-lab.git')){
    Fail FOREIGN_SOURCE 'Checkout origin is not the canonical ASA Lab repository.'
  }
  $installed=Test-Path (Join-Path $TargetRoot '.asa\installed-release.json')
}
$chosen=$Mode
if($chosen -eq 'auto'){$chosen=if($installed){'update'}else{'clean'}}
if($chosen -eq 'clean' -and $installed){Fail ALREADY_INSTALLED 'Use update; this installation has a published-release receipt.'}
if($chosen -eq 'update' -and -not $installed){Fail NOT_INSTALLED 'Use clean; there is no installed release.'}
if($chosen -eq 'update' -and $NetworkCidrs){
  Fail UPDATE_NETWORK_CHANGE 'Network CIDRs can only be chosen before a new project exists.'
}
if($chosen -eq 'update' -and $DataSource -ne 'blank'){
  Fail UPDATE_DATA_SOURCE 'Updating always preserves existing data; backup choice belongs to first installation.'
}
Say INFO ('Mode='+$chosen+' DataSource='+$DataSource)
if($DataSource -eq 'backup'){
  if(-not $BackupPath){Fail BACKUP_REQUIRED 'Select a local verified complete backup directory.'}
  $archive=[IO.Path]::GetFullPath($BackupPath)
  if(-not (Test-Path $archive)){Fail BACKUP_NOT_FOUND 'Backup path does not exist.'}
  if([IO.Path]::GetExtension($archive) -eq '.age'){
    Fail AGE_PRIVATE_DECRYPT 'The owner must decrypt the age archive into a private folder offline; no keys are guessed.'
  }
  $verifier=Join-Path $PSScriptRoot 'asa_manager.py'
  $exe=$script:Python[0]
  $pyArgs=@()
  if($script:Python.Count -gt 1){$pyArgs+=@($script:Python[1])}
  & $exe @pyArgs $verifier verify-backup --backup $archive
  if($LASTEXITCODE -ne 0){Fail BACKUP_INVALID 'Backup is incomplete or its hashes differ.'}
  Say PASS 'Backup content and hashes verified, no restore performed'
  if($Apply){Confirm-Selection 'Authorize import from this source' ([bool]$ConfirmBackupSelection)}
  Fail RESTORE_IMPORT_PENDING 'Fresh import of PostgreSQL, MinIO and secret keys requires a separate source-specific guarded restore. No blank database was created.'
}
if($chosen -eq 'clean'){
  Say INFO ('New project='+$Project+' Web='+$WebPort+' Scratch='+$BlocksPort)
  if($NetworkCidrs){Say WARN ('Explicit QA Docker networks requested: '+$NetworkCidrs)}
  if(-not $exists){Say INFO 'Would clone the official ASA Lab checkout into the fresh directory'}
}else{
  Say INFO 'Found installed ASA Lab; preserve private keys, Compose identity and Docker volumes'
}
if(-not $Apply){
  Say WARN 'PLAN_ONLY: no code, host, container, database or key changes.'
  if($chosen -eq 'clean'){
    Say INFO 'To install: add -Apply -ConfirmBlankDatabase (or confirm interactively)'
  }else{
    Say INFO 'To update: add -Apply; saved data volumes and private keys are preserved'
  }
  exit 0
}
if($chosen -eq 'clean'){
  Confirm-Selection 'Create NEW EMPTY PostgreSQL and MinIO without importing previous user data?' ([bool]$ConfirmBlankDatabase)
  if($NetworkCidrs){
    Confirm-Selection 'Create isolated Compose-only networks with the selected private subnets?' ([bool]$ConfirmPrivateDockerNetworks)
  }
  if(-not $exists){
    $parent=Split-Path -Parent $TargetRoot
    if(-not (Test-Path $parent)){Fail PARENT_NOT_FOUND 'Create the intended parent folder explicitly first.'}
    Say INFO 'Cloning canonical ASA source'
    & git clone --filter=blob:none $Canonical $TargetRoot
    if($LASTEXITCODE -ne 0){Fail CLONE_FAILED 'Git clone failed. No unrelated directory was removed.'}
  }
  $installOptions=@('--install-project',$Project,'--install-web-port',[string]$WebPort,
                    '--install-blocks-port',[string]$BlocksPort)
  if($NetworkCidrs){$installOptions+=@('--install-network-cidrs',$NetworkCidrs)}
  Invoke-Manager install $installOptions
  Say PASS ('Fresh ASA Lab installed at http://127.0.0.1:'+$WebPort)
}else{
  Invoke-Manager update @()
  Say PASS 'ASA Lab existing installation verified/updated with preserved data'
}
Say WARN 'Authenticated browser login, project save/reopen and backup must be accepted separately.'
exit 0
