param([string]$TempRoot)
$ErrorActionPreference = 'Stop'
$start = [datetime]::UtcNow.AddDays(-1)
$finish = [datetime]::UtcNow
$global:ASATestPhase = 1
function Get-WinEvent {
    [CmdletBinding()]
    param([string]$ListLog, [string]$LogName, [string]$FilterXPath, [switch]$Oldest, [int]$MaxEvents)
    if ($ListLog) {
        return @(@{LogName='A';IsEnabled=$true;RecordCount=300}, @{LogName='B';IsEnabled=$true;RecordCount=1})
    }
    if ($LogName -notin @('A','B')) { throw 'Synthetic unavailable channel' }
    if ($LogName -eq 'B' -and $global:ASATestPhase -eq 1) { throw 'Access denied' }
    if ($MaxEvents -eq 1) { return @{RecordId=if($global:ASATestPhase -eq 3){2}else{300}} }
    $range = if($LogName -eq 'B'){1..1}elseif($global:ASATestPhase -eq 1){1..256}elseif($global:ASATestPhase -eq 2){257..300}else{1..2}
    foreach ($id in $range) {
        @{RecordId=$id;Id=1001;TimeCreated=$start.AddHours(1);ProviderName='Test';Level=2;Message='Synthetic failure'}
    }
}
$cursorFile = Join-Path $TempRoot 'windows.json'
$collector = Join-Path $PSScriptRoot 'collect-windows-logs.ps1'
$first = (& $collector -Since $start.ToString('o') -Until $finish.ToString('o') -CursorFile $cursorFile | ConvertFrom-Json)
if ($first.events.Count -ne 256 -or $first.cursors.A.afterId -ne 256 -or $first.cursors.B.afterId -ne 0) { throw ('Full page or denied channel cursor failed: ' + ($first.sources | ConvertTo-Json -Compress)) }
if ($first.events[0].eventId -ne 1001 -or $first.events[0].recordId -ne 1) { throw 'Native Windows event identity was lost' }
$first.cursors | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $cursorFile -Encoding UTF8
$global:ASATestPhase = 2
$second = (& $collector -Since $start.ToString('o') -Until $finish.ToString('o') -CursorFile $cursorFile | ConvertFrom-Json)
if ($second.events.Count -ne 45 -or $second.cursors.A.afterId -ne 300 -or $second.cursors.B.afterId -ne 1) { throw 'Continuation or access recovery failed' }
$second.cursors | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $cursorFile -Encoding UTF8
$global:ASATestPhase = 3
$third = (& $collector -Since $start.ToString('o') -Until $finish.ToString('o') -CursorFile $cursorFile | ConvertFrom-Json)
if ($third.cursors.A.afterId -ne 2 -or -not ($third.sources | Where-Object { $_.channel -eq 'A' }).detail.Contains('cleared')) { throw 'Cleared channel did not resume' }
Write-Output 'Windows pagination, denied channel recovery and reset: PASS'
