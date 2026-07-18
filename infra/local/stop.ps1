# Stop the local integration environment. Data volumes are preserved.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'env.ps1')

# PostgreSQL (graceful)
if (Test-Path (Join-Path $AsaPgData 'postmaster.pid')) {
  & (Join-Path $AsaPgRoot 'bin\pg_ctl.exe') -D $AsaPgData -m fast stop | Out-Null
  Write-Host 'PostgreSQL stopped'
}

# Redis (graceful shutdown via client)
if (Test-AsaPort $AsaRedisPort) {
  & (Join-Path $AsaRedisDir 'redis-cli.exe') -h 127.0.0.1 -p $AsaRedisPort shutdown nosave *> $null
  Write-Host 'Redis stopped'
}

# MinIO (stop the process listening on the MinIO port)
$conn = Get-NetTCPConnection -LocalPort $AsaMinioPort -State Listen -ErrorAction SilentlyContinue
if ($conn) {
  $conn.OwningProcess | Sort-Object -Unique | ForEach-Object {
    try { Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Host 'MinIO stopped' } catch {}
  }
}
Write-Host 'Local integration environment stopped (data preserved).'
