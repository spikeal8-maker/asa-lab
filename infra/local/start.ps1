# Start the local integration environment (PostgreSQL, Redis, MinIO), wait for
# health, ensure the database and bucket exist. Idempotent.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'env.ps1')
Use-AsaEnv

# PostgreSQL
if (-not (Test-AsaPort $AsaPgPort)) {
  & (Join-Path $AsaPgRoot 'bin\pg_ctl.exe') -D $AsaPgData -l (Join-Path $AsaDevEnv 'postgres.log') -o "-p $AsaPgPort" start | Out-Null
}
for ($i=0; $i -lt 30; $i++) {
  & (Join-Path $AsaPgRoot 'bin\pg_isready.exe') -h 127.0.0.1 -p $AsaPgPort *> $null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Milliseconds 500
}
$exists = (& (Join-Path $AsaPgRoot 'bin\psql.exe') -h 127.0.0.1 -p $AsaPgPort -U $AsaUser -d postgres -tA -c "SELECT 1 FROM pg_database WHERE datname='$AsaDb'" 2>$null | Out-String).Trim()
if ($exists -ne '1') { & (Join-Path $AsaPgRoot 'bin\createdb.exe') -h 127.0.0.1 -p $AsaPgPort -U $AsaUser $AsaDb | Out-Null }
Write-Host "PostgreSQL ready on 127.0.0.1:$AsaPgPort (db=$AsaDb)"

# Redis
if (-not (Test-AsaPort $AsaRedisPort)) {
  Start-Process -FilePath (Join-Path $AsaRedisDir 'redis-server.exe') `
    -ArgumentList @('--port',"$AsaRedisPort",'--bind','127.0.0.1','--dir',$AsaRedisDir) `
    -WindowStyle Hidden -RedirectStandardOutput (Join-Path $AsaDevEnv 'redis.out.log') -RedirectStandardError (Join-Path $AsaDevEnv 'redis.err.log')
}
Start-Sleep -Milliseconds 800
Write-Host ("Redis ready: " + ((& (Join-Path $AsaRedisDir 'redis-cli.exe') -h 127.0.0.1 -p $AsaRedisPort ping 2>$null | Out-String).Trim()))

# MinIO
New-Item -ItemType Directory -Force $AsaMinioData | Out-Null
if (-not (Test-AsaPort $AsaMinioPort)) {
  Start-Process -FilePath (Join-Path $AsaBin 'minio.exe') `
    -ArgumentList @('server',$AsaMinioData,'--address',"127.0.0.1:$AsaMinioPort",'--console-address',"127.0.0.1:$AsaMinioConsole") `
    -WindowStyle Hidden -RedirectStandardOutput (Join-Path $AsaDevEnv 'minio.out.log') -RedirectStandardError (Join-Path $AsaDevEnv 'minio.err.log')
}
for ($i=0; $i -lt 30; $i++) { if (Test-AsaPort $AsaMinioPort) { break }; Start-Sleep -Milliseconds 500 }
& (Join-Path $AsaBin 'mc.exe') alias set asalablocal "http://127.0.0.1:$AsaMinioPort" $AsaUser $AsaPassword *> $null
& (Join-Path $AsaBin 'mc.exe') mb --ignore-existing "asalablocal/$AsaBucket" *> $null
Write-Host "MinIO ready on 127.0.0.1:$AsaMinioPort (bucket=$AsaBucket)"

Write-Host ''
Write-Host "DATABASE_URL=$AsaDatabaseUrl"
Write-Host "COMPOSE_FILE=$AsaComposeFile"
Write-Host 'Environment is up. Run tests with: python tools/run_task_tests.py --task TASK-ENV-001'
