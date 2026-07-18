# Idempotent, fully automated download+install of the local integration runtime
# into %LOCALAPPDATA%\asa-lab-devenv. User-level only: no admin, no Docker
# Desktop, no WSL/Hyper-V, no BIOS changes. Safe to re-run.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'env.ps1')

New-Item -ItemType Directory -Force $AsaDevEnv,$AsaBin,$AsaDownloads | Out-Null

function Get-File($url, $out) {
  if (-not (Test-Path $out)) {
    Write-Host "downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $out
  }
}

# Docker CLI (for `docker compose config` only; no daemon is used).
if (-not (Test-Path (Join-Path $AsaBin 'docker.exe'))) {
  $z = Join-Path $AsaDownloads "docker-$($AsaVersions.DockerCli).zip"
  Get-File "https://download.docker.com/win/static/stable/x86_64/docker-$($AsaVersions.DockerCli).zip" $z
  Expand-Archive $z $AsaDownloads -Force
  Copy-Item (Join-Path $AsaDownloads 'docker\docker.exe') $AsaBin -Force
}
$cliPlugins = Join-Path $env:USERPROFILE '.docker\cli-plugins'
New-Item -ItemType Directory -Force $cliPlugins | Out-Null
if (-not (Test-Path (Join-Path $cliPlugins 'docker-compose.exe'))) {
  Get-File "https://github.com/docker/compose/releases/download/$($AsaVersions.DockerCompose)/docker-compose-windows-x86_64.exe" (Join-Path $cliPlugins 'docker-compose.exe')
}

# PostgreSQL portable binaries + cluster init.
if (-not (Test-Path (Join-Path $AsaPgRoot 'bin\postgres.exe'))) {
  $z = Join-Path $AsaDownloads "postgresql-$($AsaVersions.PostgreSQL)-binaries.zip"
  Get-File "https://get.enterprisedb.com/postgresql/postgresql-$($AsaVersions.PostgreSQL)-1-windows-x64-binaries.zip" $z
  Expand-Archive $z $AsaDevEnv -Force
}
if (-not (Test-Path (Join-Path $AsaPgData 'PG_VERSION'))) {
  $pw = Join-Path $AsaDevEnv 'pw.txt'
  Set-Content -Path $pw -Value $AsaPassword -NoNewline -Encoding ascii
  & (Join-Path $AsaPgRoot 'bin\initdb.exe') -D $AsaPgData -U $AsaUser --pwfile=$pw --auth=scram-sha-256 --encoding=UTF8 | Out-Null
  Remove-Item $pw -Force
}

# MinIO server (pinned release) + client.
Get-File "https://dl.min.io/server/minio/release/windows-amd64/archive/minio.$($AsaVersions.MinIO)" (Join-Path $AsaBin 'minio.exe')
Get-File 'https://dl.min.io/client/mc/release/windows-amd64/mc.exe' (Join-Path $AsaBin 'mc.exe')

# Native Redis (Windows port).
if (-not (Test-Path (Join-Path $AsaRedisDir 'redis-server.exe'))) {
  $z = Join-Path $AsaDownloads "Redis-x64-$($AsaVersions.Redis).zip"
  Get-File "https://github.com/tporadowski/redis/releases/download/v$($AsaVersions.Redis)/Redis-x64-$($AsaVersions.Redis).zip" $z
  New-Item -ItemType Directory -Force $AsaRedisDir | Out-Null
  Expand-Archive $z $AsaRedisDir -Force
}

Write-Host 'ASA Lab local integration runtime is installed.'
