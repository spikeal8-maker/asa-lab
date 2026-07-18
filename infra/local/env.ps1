# Shared configuration for the ASA Lab local integration environment.
# This is the approved local equivalent of infra/docker-compose.yml for a
# Windows host without hardware virtualization / Docker (native user-level
# processes). Dot-source this file from the other scripts.
#
# No real secrets are stored here: the credentials are documented local
# development placeholders identical to .env.example.

$ErrorActionPreference = 'Stop'

$Global:AsaDevEnv   = Join-Path $env:LOCALAPPDATA 'asa-lab-devenv'
$Global:AsaBin      = Join-Path $Global:AsaDevEnv 'bin'
$Global:AsaDownloads= Join-Path $Global:AsaDevEnv 'downloads'
$Global:AsaPgRoot   = Join-Path $Global:AsaDevEnv 'pgsql'
$Global:AsaPgData   = Join-Path $Global:AsaDevEnv 'pgdata'
$Global:AsaMinioData= Join-Path $Global:AsaDevEnv 'minio-data'
$Global:AsaRedisDir = Join-Path $Global:AsaDevEnv 'redis'
$Global:AsaComposeFile = 'infra/docker-compose.yml'

# Pinned runtime versions.
$Global:AsaVersions = [ordered]@{
  DockerCli    = '27.3.1'
  DockerCompose= 'v2.29.7'
  PostgreSQL   = '16.4'
  Redis        = '5.0.14.1'
  MinIO        = 'RELEASE.2025-09-07T16-13-09Z'
}

# Local development ports and credentials (placeholders, never production).
$Global:AsaPgPort   = 5433   # 5432 is taken by another local Postgres on this host
$Global:AsaRedisPort= 6379
$Global:AsaMinioPort= 9000
$Global:AsaMinioConsole = 9001
$Global:AsaUser     = 'asalab'
$Global:AsaPassword = 'local-dev-password'
$Global:AsaDb       = 'asalab'
$Global:AsaBucket   = 'asalab-local'
$Global:AsaDatabaseUrl = "postgres://$($Global:AsaUser):$($Global:AsaPassword)@127.0.0.1:$($Global:AsaPgPort)/$($Global:AsaDb)"

function Use-AsaEnv {
  # Export the environment the test runner/tools need.
  $env:PATH = "$($Global:AsaBin);$($Global:AsaRedisDir);$($Global:AsaPgRoot)\bin;$env:PATH"
  $env:COMPOSE_FILE = $Global:AsaComposeFile
  $env:DATABASE_URL = $Global:AsaDatabaseUrl
  $env:PGPASSWORD   = $Global:AsaPassword
  $env:MINIO_ROOT_USER = $Global:AsaUser
  $env:MINIO_ROOT_PASSWORD = $Global:AsaPassword
}

function Test-AsaPort([int]$Port) {
  [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}
