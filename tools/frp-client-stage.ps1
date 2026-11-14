[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string]$ExpectedRevision,
  [Parameter(Mandatory = $true)]
  [string]$Destination
)

# Staging only. This script never reads a live FRP configuration, runs a relay,
# replaces an installed executable, manages a service, or changes network state.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$created = $false
$destinationPath = $null
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Read-Git {
  param([string[]]$Arguments)
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(& git -C $repo @Arguments 2>&1)
    $code = $LASTEXITCODE
  }
  finally { $ErrorActionPreference = $previous }
  if ($code -ne 0) { throw ('git exited {0}: {1}' -f $code, ($output -join ' ')) }
  return [string](($output -join [Environment]::NewLine).Trim())
}

function Assert-Keys {
  param($Value, [string[]]$Expected)
  $actual = @($Value.PSObject.Properties.Name)
  if (@(Compare-Object ($actual | Sort-Object) ($Expected | Sort-Object)).Count) {
    throw 'Unknown or missing release manifest fields.'
  }
}

function Write-NewJson {
  param([string]$Path, $Value)
  $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $bytes = $utf8.GetBytes(($Value | ConvertTo-Json -Depth 8) + [Environment]::NewLine)
    $stream.Write($bytes, 0, $bytes.Length)
  }
  finally { $stream.Dispose() }
}

function Receive-VerifiedArchive {
  param($Asset, [string]$Path)
  $request = [Net.HttpWebRequest]::Create([Uri]$Asset.url)
  $request.UserAgent = 'ASA-Lab-FRP-stage/1'
  $request.Timeout = 30000
  $request.ReadWriteTimeout = 15000
  $request.MaximumAutomaticRedirections = 5
  $request.UseDefaultCredentials = $false
  $response = $null
  $inputStream = $null
  $outputStream = $null
  $watch = [Diagnostics.Stopwatch]::StartNew()
  try {
    $response = $request.GetResponse()
    $uri = $response.ResponseUri
    if ($uri.Scheme -cne 'https' -or $uri.Host -notin @(
      'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'
    )) { throw 'Unexpected release download redirect.' }
    if ([int]$response.StatusCode -ne 200) { throw 'Release download did not return HTTP 200.' }
    if ($response.ContentLength -ge 0 -and $response.ContentLength -ne $Asset.sizeBytes) {
      throw 'Release Content-Length does not match the pinned manifest.'
    }
    $inputStream = $response.GetResponseStream()
    $outputStream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $buffer = New-Object byte[] 65536
    $total = 0L
    while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $total += $count
      if ($total -gt $Asset.sizeBytes -or $watch.Elapsed.TotalSeconds -gt 90) {
        throw 'Release download exceeded its pinned size or time budget.'
      }
      $outputStream.Write($buffer, 0, $count)
    }
    if ($total -ne $Asset.sizeBytes) { throw 'Release download is truncated.' }
  }
  finally {
    if ($outputStream) { $outputStream.Dispose() }
    if ($inputStream) { $inputStream.Dispose() }
    if ($response) { $response.Dispose() }
  }
  $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -cne $Asset.sha256) { throw 'Release archive SHA-256 mismatch; nothing was extracted.' }
}

try {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'This staging command requires Windows.'
  }
  $architecture = $env:PROCESSOR_ARCHITECTURE
  $nativeArchitecture = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITEW6432')
  if ($nativeArchitecture) { $architecture = $nativeArchitecture }
  if ($architecture -ine 'AMD64') { throw 'Only native Windows amd64 is in this staging matrix.' }
  $repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  $manifestPath = Join-Path $repo 'tools\deployment\frp-release.json'
  $null = Get-Command git -CommandType Application
  $revision = Read-Git @('rev-parse', 'HEAD')
  if ($revision -cne $ExpectedRevision) { throw 'HEAD does not match ExpectedRevision.' }
  $origin = Read-Git @('remote', 'get-url', 'origin')
  if ($origin -notmatch '^https://github\.com/spikeal8-maker/asa-lab(?:\.git)?/?$') {
    throw 'Source origin must be the official ASA Lab GitHub repository.'
  }
  if (Read-Git @('status', '--porcelain=v1')) { throw 'The source checkout must be clean.' }
  foreach ($relative in @('tools/frp-client-stage.ps1', 'tools/deployment/frp-release.json')) {
    $committed = Read-Git @('rev-parse', ('HEAD:' + $relative))
    $actual = Read-Git @('hash-object', '--path', $relative, (Join-Path $repo $relative))
    if ($actual -cne $committed) { throw 'Executed source differs from the expected committed blob.' }
  }

  $manifest = [IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json
  Assert-Keys $manifest @('schemaVersion', 'upstreamRepository', 'candidateVersion', 'baselineVersion', 'releases')
  if (($manifest.schemaVersion -isnot [int] -and $manifest.schemaVersion -isnot [long]) -or
      $manifest.schemaVersion -ne 1 -or $manifest.upstreamRepository -cne 'https://github.com/fatedier/frp') {
    throw 'Unsupported release schema or upstream.'
  }
  $version = [string]$manifest.candidateVersion
  $baseline = [string]$manifest.baselineVersion
  if ($version -notmatch '^\d+\.\d+\.\d+$' -or $baseline -notmatch '^\d+\.\d+\.\d+$' -or $version -ceq $baseline) {
    throw 'Two distinct pinned release versions are required.'
  }
  Assert-Keys $manifest.releases @($version, $baseline)
  foreach ($releaseVersion in @($version, $baseline)) {
    $release = $manifest.releases.$releaseVersion
    Assert-Keys $release @('publishedAt', 'releaseUrl', 'assets')
    if ($release.releaseUrl -cne ('https://github.com/fatedier/frp/releases/tag/v' + $releaseVersion)) {
      throw 'Unexpected upstream release identity.'
    }
    Assert-Keys $release.assets @('linux-amd64', 'windows-amd64')
    foreach ($platformName in @('linux-amd64', 'windows-amd64')) {
      $item = $release.assets.$platformName
      Assert-Keys $item @('file', 'url', 'sha256', 'sizeBytes')
      $extension = if ($platformName -ceq 'windows-amd64') { '.zip' } else { '.tar.gz' }
      $filename = 'frp_' + $releaseVersion + '_' + $platformName.Replace('-', '_') + $extension
      $url = 'https://github.com/fatedier/frp/releases/download/v' + $releaseVersion + '/' + $filename
      if ($item.file -cne $filename -or $item.url -cne $url -or $item.sha256 -cnotmatch '^[0-9a-f]{64}$') {
        throw 'Release artifact source/name/checksum is invalid.'
      }
      if ($item.sizeBytes -isnot [long] -and $item.sizeBytes -isnot [int]) {
        throw 'Release size must be an integer.'
      }
      if ($item.sizeBytes -le 0 -or $item.sizeBytes -gt 67108864) { throw 'Unbounded release archive.' }
    }
  }
  $asset = $manifest.releases.$version.assets.'windows-amd64'

  if ($Destination -notmatch '^[A-Za-z]:[\\/]') { throw 'Destination must be an absolute local drive path.' }
  $destinationPath = [IO.Path]::GetFullPath($Destination).TrimEnd('\', '/')
  $parent = [IO.Path]::GetDirectoryName($destinationPath)
  if (-not $parent -or -not [IO.Directory]::Exists($parent)) { throw 'Destination parent must already exist.' }
  if (Get-Item -LiteralPath $destinationPath -Force -ErrorAction SilentlyContinue) {
    throw 'Destination already exists; no existing directory or file will be changed.'
  }
  $ancestor = Get-Item -LiteralPath $parent -Force
  while ($ancestor) {
    if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw 'Destination ancestors must not be junctions or symbolic links.'
    }
    $ancestor = $ancestor.Parent
  }
  $drive = New-Object -TypeName IO.DriveInfo -ArgumentList ([IO.Path]::GetPathRoot($destinationPath))
  if ($drive.AvailableFreeSpace -lt 268435456) { throw 'Staging requires at least 256 MiB free disk space.' }

  # CreateDirectoryW fails atomically if the destination was concurrently created.
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AsaFrpStageDirectory {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CreateDirectory(string path, IntPtr securityAttributes);
}
'@
  if (-not [AsaFrpStageDirectory]::CreateDirectory($destinationPath, [IntPtr]::Zero)) {
    throw ('Cannot exclusively create new staging directory; Win32 error ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
  $created = $true
  $archivePath = Join-Path $destinationPath $asset.file
  Receive-VerifiedArchive $asset $archivePath
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    foreach ($name in @('frpc.exe', 'LICENSE')) {
      $expected = 'frp_' + $version + '_windows_amd64/' + $name
      $entries = @($archive.Entries | Where-Object { $_.FullName -ceq $expected })
      if ($entries.Count -ne 1 -or $entries[0].Length -le 0 -or $entries[0].Length -gt 67108864) {
        throw 'Missing, duplicate or unbounded expected archive entry.'
      }
      $unixType = ($entries[0].ExternalAttributes -shr 16) -band 61440
      if ($unixType -eq 40960) { throw 'Archive symbolic links are forbidden.' }
      $inputStream = $entries[0].Open()
      $outputStream = [IO.File]::Open((Join-Path $destinationPath $name), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      try {
        $buffer = New-Object byte[] 65536
        $total = 0L
        while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
          $total += $count
          if ($total -gt $entries[0].Length) { throw 'Archive member exceeds its declared size.' }
          $outputStream.Write($buffer, 0, $count)
        }
        if ($total -ne $entries[0].Length) { throw 'Archive member is truncated.' }
      }
      finally { $outputStream.Dispose(); $inputStream.Dispose() }
    }
  }
  finally { $archive.Dispose() }
  $receipt = [ordered]@{
    schemaVersion = 1
    status = 'staged_only'
    sourceRepository = 'https://github.com/spikeal8-maker/asa-lab'
    sourceRevision = $revision
    manifestSha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    version = $version
    archiveUrl = $asset.url
    archiveSha256 = $asset.sha256
    archiveSizeBytes = $asset.sizeBytes
    binarySha256 = (Get-FileHash -LiteralPath (Join-Path $destinationPath 'frpc.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
    destination = $destinationPath
    stagedAtUtc = [DateTime]::UtcNow.ToString('o')
    liveConfigurationRead = $false
    liveBinaryReplaced = $false
    relayStarted = $false
    serviceRestarted = $false
    publicFrpsCompatibility = 'NOT_VERIFIED'
    deployment = 'NOT_APPLIED'
  }
  Write-NewJson (Join-Path $destinationPath 'receipt.json') $receipt
  $receipt | ConvertTo-Json -Depth 4
}
catch {
  $failureMessage = $_.Exception.Message
  if ($created) {
    try {
      Write-NewJson (Join-Path $destinationPath 'failure.json') ([ordered]@{
        schemaVersion = 1; status = 'failed'; deployment = 'NOT_APPLIED'
        error = $failureMessage; retainedDirectory = $destinationPath
      })
    }
    catch { }
  }
  [Console]::Error.WriteLine('FRP staging failed: ' + $failureMessage)
  exit 1
}
