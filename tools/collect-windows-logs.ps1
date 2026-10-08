param([string]$Since, [string]$Until, [string]$CursorFile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$cursors = @{}
if (Test-Path -LiteralPath $CursorFile) {
    $saved = Get-Content -LiteralPath $CursorFile -Raw | ConvertFrom-Json
    foreach ($entry in $saved.PSObject.Properties) { $cursors[$entry.Name] = @{since=$entry.Value.since; afterId=$entry.Value.afterId} }
}
$discoveryErrors = @()
$channels = @(Get-WinEvent -ListLog * -ErrorAction SilentlyContinue -ErrorVariable +discoveryErrors | Where-Object { $_.IsEnabled -and $_.RecordCount -gt 0 })
foreach ($critical in @('Security','Application','System')) {
    if (-not ($channels | Where-Object { $_.LogName -eq $critical })) {
        $channels += @{LogName=$critical;IsEnabled=$true;RecordCount=1}
    }
}
$events = [System.Collections.Generic.List[object]]::new()
$sources = [System.Collections.Generic.List[object]]::new()
$messageBytes = 0
$channels = @($channels | Sort-Object { if ($cursors.ContainsKey($_.LogName)) { $cursors[$_.LogName].since } else { $Since } })
foreach ($channel in $channels) {
    $name = $channel.LogName
    if (-not $cursors.ContainsKey($name)) { $cursors[$name] = @{since=$Since;afterId=0} }
    $cursor = $cursors[$name]
    try {
        $from = ([datetime]$cursor.since).ToUniversalTime()
        $to = ([datetime]$Until).ToUniversalTime()
        if ($from.AddHours(6) -lt $to) { $to = $from.AddHours(6) }
        $fromText = $from.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        $toText = $to.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        $after = [long]$cursor.afterId
        if ($messageBytes -ge 2MB) {
            $sources.Add(@{channel=$name;state='pending';detail='History collection is queued';collectedThrough=$cursor.since})
            continue
        }
        $latest = Get-WinEvent -LogName $name -MaxEvents 1 -ErrorAction Stop
        $reset = [long]$latest.RecordId -lt $after
        if ($reset) { $after = 0 }
        $filter = "*[System[TimeCreated[@SystemTime >= '$fromText' and @SystemTime <= '$toText'] and EventRecordID > $after]]"
        $readErrors = @()
        $records = @(Get-WinEvent -LogName $name -FilterXPath $filter -Oldest -MaxEvents 256 -ErrorAction SilentlyContinue -ErrorVariable +readErrors)
        $realErrors = @($readErrors | Where-Object { $_.FullyQualifiedErrorId -notmatch 'NoMatchingEventsFound' })
        if ($realErrors.Count) { throw ($realErrors[0].ToString()) }
        foreach ($event in $records) {
            $message = [string]$event.Message
            $messageBytes += [System.Text.Encoding]::UTF8.GetByteCount($message.Substring(0,[Math]::Min(16384,$message.Length)))
            $events.Add(@{channel=$name; eventId=$event.Id; recordId=$event.RecordId; time=$event.TimeCreated.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'); provider=$event.ProviderName; level=$event.Level; message=$message.Substring(0,[Math]::Min(16384,$message.Length)); truncated=($message.Length -gt 16384)})
        }
        if ($records.Count -eq 256) {
            $last = $records[-1]
            $cursors[$name] = @{since=$last.TimeCreated.ToUniversalTime().ToString('o');afterId=$last.RecordId}
        } else {
            $cursors[$name] = @{since=$toText;afterId=if($records.Count){$records[-1].RecordId}else{$after}}
        }
        $sources.Add(@{channel=$name; state='ok'; detail=if($reset){'Channel was cleared; older history is unavailable'}else{''};collectedThrough=$cursors[$name].since})
    } catch { $sources.Add(@{channel=$name; state='unavailable'; detail=$_.Exception.Message;collectedThrough=$cursor.since}) }
}
foreach ($failure in $discoveryErrors) {
    $text = $failure.ToString()
    $match = [regex]::Match($text,"'([^']+)'")
    $name = if($match.Success){$match.Groups[1].Value}else{'discovery'}
    if (-not $cursors.ContainsKey($name)) { $cursors[$name] = @{since=$Since;afterId=0} }
    $sources.Add(@{channel=$name;state='unavailable';detail=$text;collectedThrough=$cursors[$name].since})
}
@{events=@($events.ToArray());sources=@($sources.ToArray());cursors=$cursors} | ConvertTo-Json -Depth 6 -Compress
