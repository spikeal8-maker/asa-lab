param(
  [ValidateSet('Setup', 'Start', 'Stop', 'Status')]
  [string]$Action = 'Status',
  [switch]$KeepDatabase
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$PgName = 'asa-lab-robotics-fast-pg'
$PgVolume = 'asa-lab-robotics-fast-pg-data'
$DbName = 'asalab_robotics_fast'
$State = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'ASA-Lab-Robotics-Fast-Dev-001'
$EnvFile = Join-Path $Root '.env.local'
$StopFile = Join-Path $Root '.asa-dev-stop'
$PidFile = Join-Path $State 'dev.pid'
$ScopeLabel = 'asa-lab.scope'
$ScopeValue = 'robotics-fast-dev-001'
Set-Location $Root

function New-Secret {
  $bytes = New-Object byte[] 28
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}

function Load-Environment {
  if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw 'No isolated .env.local found. Run -Action Setup first.'
  }
  foreach ($line in [IO.File]::ReadAllLines($EnvFile)) {
    if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { continue }
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
  }
  if ($env:ASA_WEB_PORT -ne '4630' -or $env:ASA_API_PORT -ne '4631' -or
      $env:MIGRATION_EXPECT_DATABASE -ne $DbName -or
      $env:MIGRATION_CONFIRM -ne "APPLY:$DbName" -or
      $env:APP_DATABASE_URL -notmatch '127\.0\.0\.1:4632/asalab_robotics_fast$' -or
      $env:MIGRATION_DATABASE_URL -notmatch '127\.0\.0\.1:4632/asalab_robotics_fast$') {
    throw 'BLOCKED: isolated database / port attestation mismatch; refusing to proceed.'
  }
}

function Assert-PortAvailable([int]$Port) {
  $owners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  if ($owners.Count -gt 0) {
    throw "BLOCKED: port $Port is occupied by PID(s): $($owners.OwningProcess -join ',')"
  }
}

function Get-OwnContainer {
  $names = @(& docker ps -a --filter "name=^/$PgName$" --format '{{.Names}}')
  if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Docker container names.' }
  if ($names -notcontains $PgName) { return $null }
  $raw = & docker inspect $PgName
  if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect dedicated PostgreSQL container.' }
  $info = @(($raw -join [Environment]::NewLine | ConvertFrom-Json))[0]
  if ($info.Config.Labels.$ScopeLabel -ne $ScopeValue) {
    throw "BLOCKED: existing Docker container '$PgName' is not owned by this stand."
  }
  return $info
}

function Wait-Pg {
  for ($i = 0; $i -lt 50; $i++) {
    & docker exec $PgName pg_isready -U asalab -d $DbName *> $null
    if ($LASTEXITCODE -eq 0) { return }
    Start-Sleep -Milliseconds 750
  }
  throw 'PostgreSQL did not become ready.'
}

New-Item -ItemType Directory -Path $State -Force | Out-Null

switch ($Action) {
  'Setup' {
    if (-not (Test-Path 'node_modules\vite\bin\vite.js')) {
      & corepack.cmd pnpm install --frozen-lockfile --prefer-offline
      if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
    }
    if (-not (Test-Path $EnvFile)) {
      $dbPassword = New-Secret
      $appPassword = New-Secret
      $teacherPassword = New-Secret
      $lines = @(
        'ASA_WEB_PORT=4630',
        'ASA_API_PORT=4631',
        "MIGRATION_DATABASE_URL=postgres://asalab:$dbPassword@127.0.0.1:4632/$DbName",
        "MIGRATION_EXPECT_DATABASE=$DbName",
        "MIGRATION_CONFIRM=APPLY:$DbName",
        "APP_DATABASE_URL=postgres://asalab_app:$appPassword@127.0.0.1:4632/$DbName",
        "ASA_APP_DB_PASSWORD=$appPassword",
        'ASA_SEED_WORKSPACE=robotics-fast-dev',
        'ASA_SEED_TEACHER_EMAIL=robotics@local.invalid',
        "ASA_SEED_TEACHER_PASSWORD=$teacherPassword",
        'ASA_STUDENT_CODE_PROTECTION_MODE=off',
        "CLASSROOM_CODE_SECRET=$(New-Secret)"
      )
      [IO.File]::WriteAllLines($EnvFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
      Write-Output "Created private config: $EnvFile"
    }
    Load-Environment
    $existing = Get-OwnContainer
    if (-not $existing) {
      Assert-PortAvailable 4632
      $dbPass = ([Uri]$env:MIGRATION_DATABASE_URL).UserInfo.Split(':')[1]
      & docker volume create --label "$ScopeLabel=$ScopeValue" $PgVolume | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'Docker volume creation failed' }
      $id = & docker run -d --name $PgName --label "$ScopeLabel=$ScopeValue" --restart unless-stopped -p 127.0.0.1:4632:5432 -v ($PgVolume + ':/var/lib/postgresql/data') -e 'POSTGRES_USER=asalab' -e "POSTGRES_PASSWORD=$dbPass" -e "POSTGRES_DB=$DbName" postgres:16
      if ($LASTEXITCODE -ne 0) { throw 'Docker PostgreSQL startup failed' }
      Write-Output "Created dedicated PostgreSQL container $PgName"
    } elseif (-not $existing.State.Running) {
      & docker start $PgName | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'Could not start existing dedicated database' }
    }
    Wait-Pg
    & node tools/migrate.mjs --check
    if ($LASTEXITCODE -ne 0) { throw 'Migration validation failed' }
    & node tools/migrate.mjs --apply
    if ($LASTEXITCODE -ne 0) { throw 'Migration apply failed' }
    $env:LOCALAPPDATA = Join-Path $State 'seed-home'
    New-Item -ItemType Directory -Path $env:LOCALAPPDATA -Force | Out-Null
    & node tools/seed-dev.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Local demo tenant seed failed' }
    Write-Output 'SETUP_OK: dedicated database, migrations and demo account; shared databases not used.'
    Write-Output "Demo email: $env:ASA_SEED_TEACHER_EMAIL"
    Write-Output "Demo password saved privately in $EnvFile (ASA_SEED_TEACHER_PASSWORD)."
  }
  'Start' {
    Load-Environment
    Assert-PortAvailable 4630
    Assert-PortAvailable 4631
    $existing = Get-OwnContainer
    if (-not $existing) { throw 'Dedicated PostgreSQL absent: run -Action Setup' }
    if (-not $existing.State.Running) {
      & docker start $PgName | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'Dedicated PostgreSQL failed to start' }
    }
    Wait-Pg
    if (Test-Path $StopFile) { Remove-Item -LiteralPath $StopFile -Force }
    $stdout = Join-Path $State 'dev.stdout.log'
    $stderr = Join-Path $State 'dev.stderr.log'
    $node = (Get-Command node.exe).Source
    $dev = Start-Process -FilePath $node -ArgumentList @('tools/dev.mjs') -WorkingDirectory $Root -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    [IO.File]::WriteAllText($PidFile, [string]$dev.Id)
    Write-Output "DEV_STARTED PID=$($dev.Id)"
    Write-Output 'Web: http://127.0.0.1:4630'
    Write-Output 'API: http://127.0.0.1:4631'
    Write-Output "Log stdout: $stdout"
    Write-Output "Log stderr: $stderr"
  }
  'Stop' {
    $knownPid = if (Test-Path $PidFile) { [int]([IO.File]::ReadAllText($PidFile).Trim()) } else { 0 }
    if ($knownPid -ne 0) {
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$knownPid" -ErrorAction SilentlyContinue
      if ($proc) {
        if ($proc.Name -ne 'node.exe' -or $proc.CommandLine -notmatch 'tools[/\\]dev\.mjs') {
          throw "BLOCKED: PID $knownPid no longer belongs to this dev orchestrator."
        }
        New-Item -ItemType File -Path $StopFile -Force | Out-Null
        for ($i = 0; $i -lt 35; $i++) {
          Start-Sleep -Milliseconds 500
          if (-not (Get-Process -Id $knownPid -ErrorAction SilentlyContinue)) { break }
        }
        if (Get-Process -Id $knownPid -ErrorAction SilentlyContinue) {
          throw "BLOCKED: dev PID $knownPid did not exit gracefully. No unrelated process killed."
        }
      }
      Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    }
    if (-not $KeepDatabase) {
      $existing = Get-OwnContainer
      if ($existing -and $existing.State.Running) {
        & docker stop $PgName | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Dedicated database did not stop' }
      }
    }
    Write-Output 'STOP_OK: only tracked stand processes were asked to stop.'
  }
  'Status' {
    Write-Output ('Git: ' + (& git branch --show-current))
    Write-Output ('SHA: ' + (& git rev-parse HEAD))
    foreach ($port in @(4630, 4631, 4632, 8099, 4610)) {
      $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
      Write-Output ("PORT {0}: {1}" -f $port, ($(if ($listeners) { $listeners.OwningProcess -join ',' } else { 'free' })))
    }
    if (Test-Path $PidFile) { Write-Output ('Dev PID: ' + [IO.File]::ReadAllText($PidFile)) }
    if (Test-Path $EnvFile) { Write-Output 'Private environment exists (values hidden).' }
    if (Test-Path (Join-Path $State 'dev.stderr.log')) { Get-Content (Join-Path $State 'dev.stderr.log') -Tail 15 }
  }
}
