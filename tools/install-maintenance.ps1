[CmdletBinding()]
param([ValidateSet('dev', 'production', 'staging', 'base')][string]$Profile = 'production')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = (Get-Command python -ErrorAction Stop).Source
& $python (Join-Path $PSScriptRoot 'asa_manager.py') configure --profile $Profile --enable-auto-update
if ($LASTEXITCODE -ne 0) { throw 'Maintenance preflight failed; no task was installed.' }
$settings = Get-Content -Raw (Join-Path $root '.asa\installation.json') | ConvertFrom-Json
$name = 'ASA-Lab-Update-' + $settings.project
$escape = { param($value) [System.Security.SecurityElement]::Escape([string]$value) }
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$command = & $escape $python
$arguments = & $escape ('"' + (Join-Path $PSScriptRoot 'maintenance_runner.py') + '"')
$directory = & $escape $root
$user = & $escape $identity
# Polling is cheap; the shared runner enforces Sunday 00:00-02:00 UTC (Moscow
# 03:00-05:00) independently of the Windows timezone and missed triggers.
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers><CalendarTrigger><Repetition><Interval>PT15M</Interval><Duration>P1D</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>2026-01-01T00:00:00</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>$user</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>false</StartWhenAvailable><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Enabled>true</Enabled></Settings>
  <Actions Context="Author"><Exec><Command>$command</Command><Arguments>$arguments</Arguments><WorkingDirectory>$directory</WorkingDirectory></Exec></Actions>
</Task>
"@
Register-ScheduledTask -TaskName $name -Xml $xml -Force | Out-Null
Write-Host "Scheduled: $name; Sunday 03:00-05:00 Moscow. Docker Desktop and this user's session must be running."
