[CmdletBinding()]
param([string]$Root = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path -LiteralPath $Root).Path
$python = (Get-Command python -ErrorAction Stop).Source
$hiddenPython = Join-Path (Split-Path -Parent $python) 'pythonw.exe'
if (Test-Path -LiteralPath $hiddenPython) { $python = $hiddenPython }
$installFile = Join-Path $Root '.asa\installation.json'
if (-not (Test-Path -LiteralPath $installFile)) { throw 'Use the canonical installed ASA directory.' }
$installation = Get-Content -LiteralPath $installFile -Raw | ConvertFrom-Json
$configPath = Join-Path $Root '.asa\log-collector.json'
if (-not (Test-Path -LiteralPath $configPath)) {
    $sources = @()
    $backupLogs = Join-Path (Split-Path -Parent $Root) 'operations\backup-logs'
    if (Test-Path -LiteralPath $backupLogs) { $sources += @{source='backup';path=$backupLogs} }
    $service = Get-CimInstance Win32_Service -Filter "Name='ASAFrpc'" -ErrorAction SilentlyContinue
    if ($service) {
        $match = [regex]::Match($service.PathName, '^"([^"]+)"')
        if ($match.Success) {
            $transportRoot = Split-Path -Parent $match.Groups[1].Value
            foreach ($name in @('logs','service-logs')) {
                $path = Join-Path $transportRoot $name
                if (Test-Path -LiteralPath $path) { $sources += @{source='tunnel';path=$path} }
            }
        }
    }
    @{version=1;project=$installation.project;retentionDays=30;maxBytes=1073741824;intervalSeconds=20;fileSources=$sources} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8
}
New-Item -ItemType Directory -Path (Join-Path $Root '.asa\diagnostics\store') -Force | Out-Null
$escape = { param($text) [System.Security.SecurityElement]::Escape([string]$text) }
$user = & $escape ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
$command = & $escape $python
$arguments = & $escape ('"' + (Join-Path $Root 'tools\collect_logs.py') + '" --root "' + $Root + '"')
$directory = & $escape $Root
$name = 'ASA-Lab-Logs-' + $installation.project
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<Triggers><LogonTrigger><Enabled>true</Enabled><UserId>$user</UserId></LogonTrigger><CalendarTrigger><Repetition><Interval>PT5M</Interval><Duration>P1D</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>2026-01-01T00:00:00</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers>
<Principals><Principal id="Author"><UserId>$user</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Enabled>true</Enabled><RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure></Settings>
<Actions Context="Author"><Exec><Command>$command</Command><Arguments>$arguments</Arguments><WorkingDirectory>$directory</WorkingDirectory></Exec></Actions>
</Task>
"@
Register-ScheduledTask -TaskName $name -Xml $xml -Force | Out-Null
Start-ScheduledTask -TaskName $name
Write-Output "Log collector registered: $name. Store: .asa/diagnostics/store. Requires the Docker Desktop user session."
