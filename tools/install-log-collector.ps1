[CmdletBinding()]
param([string]$Root)
$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = (Resolve-Path -LiteralPath $Root).Path
& python (Join-Path $Root 'tools/log_collector.py') prepare --root $Root
if ($LASTEXITCODE -ne 0) { throw 'Collector preparation failed; existing history is preserved.' }
& python (Join-Path $Root 'tools/log_collector.py') reconcile --root $Root
if ($LASTEXITCODE -ne 0) { throw 'Collector is degraded; inspect .asa/collector-operation.json.' }
