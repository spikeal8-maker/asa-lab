[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
$ErrorActionPreference = 'Stop'
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw 'Install Python 3.11 or newer, then repeat this command.' }
& $python.Source (Join-Path $PSScriptRoot 'asa_manager.py') @Arguments
exit $LASTEXITCODE
