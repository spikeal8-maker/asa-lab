# Stop the environment and wipe local data volumes, then re-initialise the
# empty PostgreSQL cluster. Destroys local development data only.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'env.ps1')

& (Join-Path $here 'stop.ps1')
Start-Sleep -Seconds 1

foreach ($dir in @($AsaPgData, $AsaMinioData)) {
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir; Write-Host "removed $dir" }
}
Get-ChildItem $AsaRedisDir -Filter '*.rdb' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

# Re-initialise an empty PostgreSQL cluster.
$pw = Join-Path $AsaDevEnv 'pw.txt'
Set-Content -Path $pw -Value $AsaPassword -NoNewline -Encoding ascii
& (Join-Path $AsaPgRoot 'bin\initdb.exe') -D $AsaPgData -U $AsaUser --pwfile=$pw --auth=scram-sha-256 --encoding=UTF8 | Out-Null
Remove-Item $pw -Force
Write-Host 'Local integration environment reset (empty data volumes).'
