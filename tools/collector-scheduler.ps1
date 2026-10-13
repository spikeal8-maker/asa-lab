[CmdletBinding()]
param(
    [ValidateSet('query','register','stop','start','discover')][string]$Action,
    [Parameter(Mandatory=$true)][string]$Name,
    [string]$XmlPath
)
$ErrorActionPreference = 'Stop'
if ($Name -notmatch '^ASA-Lab-Logs-[a-z0-9][a-z0-9_-]*$') { throw 'Invalid ASA collector task name.' }
switch ($Action) {
    'discover' {
        $sources = @()
        $service = Get-CimInstance Win32_Service -Filter "Name='ASAFrpc'" -ErrorAction SilentlyContinue
        if ($service) {
            $match = [regex]::Match($service.PathName, '^"([^"]+)"')
            if ($match.Success) {
                $transportRoot = Split-Path -Parent $match.Groups[1].Value
                foreach ($folder in @('logs','service-logs')) {
                    $path = Join-Path $transportRoot $folder
                    if (Test-Path -LiteralPath $path -PathType Container) { $sources += @{source='tunnel';path=$path} }
                }
            }
        }
        ConvertTo-Json -InputObject $sources -Compress
    }
    'query' {
        $task = Get-ScheduledTask | Where-Object { $_.TaskName -eq $Name -and $_.TaskPath -eq '\' }
        if ($task) {
            if ($task.Principal.UserId -match '^S-1-') {
                $sid = (New-Object System.Security.Principal.SecurityIdentifier($task.Principal.UserId)).Value
            } else {
                $principal = New-Object System.Security.Principal.NTAccount($task.Principal.UserId)
                $sid = $principal.Translate([System.Security.Principal.SecurityIdentifier]).Value
            }
            @{xml=(Export-ScheduledTask -TaskName $Name -TaskPath '\');principalSid=$sid} | ConvertTo-Json -Compress
        }
        else { @{xml=$null} | ConvertTo-Json -Compress }
    }
    'register' { Register-ScheduledTask -TaskName $Name -TaskPath '\' -Xml (Get-Content -LiteralPath $XmlPath -Raw) -Force | Out-Null }
    'stop' { Stop-ScheduledTask -TaskName $Name -TaskPath '\' }
    'start' { Start-ScheduledTask -TaskName $Name -TaskPath '\' }
}
